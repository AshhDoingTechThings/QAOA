"""QAOA engine.

* Exact statevector simulation in NumPy (cost layer is diagonal, mixer is a
  product of RX rotations applied by tensor reshaping) — fast enough for an
  interactive demo up to 16 qubits.
* Results are cross-checked against Qiskit's Statevector, and Qiskit's
  transpiler reports real circuit depth / two-qubit gate counts.
* Noise: stochastic Pauli (depolarising) quantum trajectories inserted after
  every layer, plus read-out bit-flip error — the same noise picture as a
  Qiskit-Aer depolarising model, without the density-matrix memory cost.

Convention: qubit i ↔ bit i of the basis index (little-endian, as in Qiskit).
    |γ,β⟩ = Π_k  e^{-iβ_k H_M} e^{-iγ_k Ĥ_C} |+⟩^{⊗n},   H_M = Σ X_i,
    Ĥ_C = (H_C − offset)/s   with s = max|h,J|   (normalised so angles are O(1)).
"""
from __future__ import annotations

import math
import time
from functools import lru_cache
from typing import Dict, List, Optional

import numpy as np
from scipy.optimize import minimize

from .qubo import Model, describe_solution, feasible_mask

try:  # optional, used for verification + transpiled metrics + QASM
    from qiskit import QuantumCircuit, transpile, qasm2
    from qiskit.quantum_info import Statevector
    from qiskit.transpiler import CouplingMap
    HAVE_QISKIT = True
except Exception:  # pragma: no cover
    HAVE_QISKIT = False


class QAOASim:
    def __init__(self, model: Model):
        self.m = model
        self.n = model.n_qubits
        self.N = 1 << self.n
        self.E = model.energies                     # true QUBO energies (for reporting)
        self.scale = float(max(np.abs(model.h).max(), np.abs(model.J).max(), 1e-12))
        self.Hn = (self.E - model.offset) / self.scale
        self.order = np.argsort(self.E)
        self.edges = [(i, j, model.J[i, j]) for i in range(self.n) for j in range(i + 1, self.n)
                      if abs(model.J[i, j]) > 1e-12]
        self.n_evals = 0

    # ---------------------------------------------------------------- state
    def mixer(self, psi, beta):
        c, s = math.cos(beta), -1j * math.sin(beta)
        for q in range(self.n):
            v = psi.reshape(self.N >> (q + 1), 2, 1 << q)
            a, b = v[:, 0, :].copy(), v[:, 1, :]
            v[:, 0, :] = c * a + s * b
            v[:, 1, :] = s * a + c * b
        return psi

    def state(self, params, p):
        g, b = params[:p], params[p:]
        psi = np.full(self.N, 1 / math.sqrt(self.N), dtype=np.complex128)
        for k in range(p):
            psi *= np.exp(-1j * g[k] * self.Hn)
            psi = self.mixer(psi, b[k])
        return psi

    # ------------------------------------------------------------ objectives
    def expectation(self, probs):
        return float(probs @ self.E)

    def cvar(self, probs, alpha):
        p = probs[self.order]
        e = self.E[self.order]
        cum = np.cumsum(p)
        k = int(np.searchsorted(cum, alpha))
        k = min(k, len(p) - 1)
        mass_before = cum[k - 1] if k > 0 else 0.0
        val = (p[:k] @ e[:k]) + (alpha - mass_before) * e[k]
        return float(val / alpha)

    # ---------------------------------------------------------- optimise
    def initial(self, p, strategy, rng):
        if strategy == "random":
            return np.concatenate([rng.uniform(0, math.pi, p), rng.uniform(0, math.pi / 2, p)])
        # linear ramp ("trotterised adiabatic" start, Zhou et al. 2020)
        dt = 0.75
        k = (np.arange(p) + 0.5) / p
        return np.concatenate([k * dt, (1 - k) * dt])

    def _fun(self, p, objective, alpha, trace, stage):
        def f(x):
            probs = np.abs(self.state(x, p)) ** 2
            e = self.expectation(probs)
            val = self.cvar(probs, alpha) if objective == "cvar" else e
            self.n_evals += 1
            trace.append({"g": x[:p].tolist(), "b": x[p:].tolist(), "v": val, "exp": e, "stage": stage})
            return val
        return f

    def _minimize(self, f, x0, optimizer, maxiter, rho=0.3):
        opts = {"maxiter": maxiter}
        if optimizer == "COBYLA":
            opts["rhobeg"] = rho
        return minimize(f, x0, method=optimizer, options=opts)

    @staticmethod
    def interp(x, p):
        """INTERP heuristic (Zhou et al., PRX 2020): p → p+1 initial angles."""
        def I(v):
            v = np.concatenate([[0.0], v, [0.0]])
            return np.array([(i - 1) / p * v[i - 1] + (p - i + 1) / p * v[i] for i in range(1, p + 2)])
        return np.concatenate([I(x[:p]), I(x[p:])])

    def optimize(self, p=1, optimizer="COBYLA", init="interp", objective="expectation",
                 alpha=0.2, restarts=2, maxiter=250, seed=0):
        rng = np.random.default_rng(seed)
        t0 = time.perf_counter()
        if init == "interp":
            # coarse p=1 grid → best `restarts` seeds → local refine → grow depth layer by layer
            trace = []
            coarse = []
            for g in np.linspace(0.1, math.pi * 0.9, 10):
                phase = np.exp(-1j * g * self.Hn)
                for b in np.linspace(-math.pi / 2 * 0.9, math.pi / 2 * 0.9, 9):
                    psi = self.mixer(np.full(self.N, 1 / math.sqrt(self.N), dtype=np.complex128) * phase, b)
                    pr = np.abs(psi) ** 2
                    coarse.append((self.cvar(pr, alpha) if objective == "cvar" else self.expectation(pr), g, b))
            coarse.sort()
            best = None
            for _, g, b in coarse[:restarts]:
                tr = []
                res = self._minimize(self._fun(1, objective, alpha, tr, 1), np.array([g, b]), optimizer, maxiter, 0.15)
                if best is None or res.fun < best[1]:
                    best, trace = (res.x, res.fun), tr
            x = best[0]
            for k in range(2, p + 1):
                res = self._minimize(self._fun(k, objective, alpha, trace, k), self.interp(x, k - 1),
                                     optimizer, maxiter, 0.1)
                x = res.x
                best = (x, res.fun)
            return {"params": best[0], "value": best[1], "best_restart": 0, "trace": trace,
                    "optimize_ms": 1000 * (time.perf_counter() - t0)}

        best, best_trace = None, None
        for r in range(restarts):
            x0 = self.initial(p, init if r == 0 else "random", rng)
            trace = []
            res = self._minimize(self._fun(p, objective, alpha, trace, p), x0, optimizer, maxiter)
            if best is None or res.fun < best[1]:
                best, best_trace = (res.x, res.fun, r), trace
        return {"params": best[0], "value": best[1], "best_restart": best[2], "trace": best_trace,
                "optimize_ms": 1000 * (time.perf_counter() - t0)}

    # -------------------------------------------------------- bloch vectors
    def bloch(self, psi):
        out = []
        for q in range(self.n):
            v = psi.reshape(self.N >> (q + 1), 2, 1 << q)
            a, b = v[:, 0, :], v[:, 1, :]
            c = np.vdot(a, b)
            out.append([float(2 * c.real), float(2 * c.imag),
                        float((np.abs(a) ** 2).sum() - (np.abs(b) ** 2).sum())])
        return out

    def evolution(self, params, p):
        """Per-qubit Bloch vectors and ⟨H_C⟩ after every circuit layer."""
        g, b = params[:p], params[p:]
        psi = np.full(self.N, 1 / math.sqrt(self.N), dtype=np.complex128)
        steps = [{"label": "H⊗n  (|+⟩ⁿ)", "bloch": self.bloch(psi), "exp": self.expectation(np.abs(psi) ** 2)}]
        for k in range(p):
            psi *= np.exp(-1j * g[k] * self.Hn)
            steps.append({"label": f"Cost layer {k + 1}  e^(-iγ{k + 1}H_C)", "bloch": self.bloch(psi),
                          "exp": self.expectation(np.abs(psi) ** 2)})
            psi = self.mixer(psi, b[k])
            steps.append({"label": f"Mixer layer {k + 1}  e^(-iβ{k + 1}H_M)", "bloch": self.bloch(psi),
                          "exp": self.expectation(np.abs(psi) ** 2)})
        return steps

    # ------------------------------------------------------------- sampling
    def sample(self, psi, shots, rng):
        probs = np.abs(psi) ** 2
        probs /= probs.sum()
        return np.bincount(rng.choice(self.N, size=shots, p=probs), minlength=self.N)

    def _pauli(self, psi, q, which):
        v = psi.reshape(self.N >> (q + 1), 2, 1 << q)
        if which in (2, 3):  # Z (Y = iXZ up to global phase)
            v[:, 1, :] *= -1
        if which in (1, 3):  # X
            v[:, [0, 1], :] = v[:, [1, 0], :]
        return psi

    def noisy_counts(self, params, p, shots, rng, e1=0.001, e2=0.01, ro=0.02, trajectories=64):
        deg = np.zeros(self.n)
        for i, j, _ in self.edges:
            deg[i] += 1
            deg[j] += 1
        has_h = np.abs(self.m.h) > 1e-12
        p_cost = 1 - (1 - e2) ** deg * (1 - e1) ** has_h
        p_mix = np.full(self.n, e1)
        g, b = params[:p], params[p:]
        counts = np.zeros(self.N, dtype=np.int64)
        per = np.full(trajectories, shots // trajectories)
        per[: shots % trajectories] += 1
        exp_sum = 0.0

        def inject(psi, probs_q):
            hit = rng.random(self.n) < probs_q
            for q in np.nonzero(hit)[0]:
                psi = self._pauli(psi, q, int(rng.integers(1, 4)))
            return psi

        for t in range(trajectories):
            psi = np.full(self.N, 1 / math.sqrt(self.N), dtype=np.complex128)
            psi = inject(psi, p_mix)  # Hadamard layer
            for k in range(p):
                psi *= np.exp(-1j * g[k] * self.Hn)
                psi = inject(psi, p_cost)
                psi = self.mixer(psi, b[k])
                psi = inject(psi, p_mix)
            probs = np.abs(psi) ** 2
            exp_sum += probs @ self.E * per[t]
            if per[t] == 0:
                continue
            idx = rng.choice(self.N, size=int(per[t]), p=probs / probs.sum())
            if ro > 0:
                flips = rng.random((idx.size, self.n)) < ro
                idx = idx ^ (flips * (1 << np.arange(self.n))).sum(axis=1)
            counts += np.bincount(idx, minlength=self.N)
        n2 = len(self.edges) * p
        n1 = self.n + p * (int(has_h.sum()) + self.n)
        fidelity = (1 - e2) ** n2 * (1 - e1) ** n1 * (1 - ro) ** self.n
        return counts, exp_sum / shots, fidelity


# ---------------------------------------------------------------- circuits
def analytic_circuit_stats(n, edges, n_h, p):
    t = np.zeros(n)
    t += 1  # H layer
    for _ in range(p):
        for i, j, _ in edges:  # RZZ = CX · RZ · CX
            s = max(t[i], t[j])
            t[i] = t[j] = s + 3
        t += 0  # RZ fused into the layer below (per-qubit)
        for q in range(n):
            t[q] += 1  # RZ (h) – counted even if h=0 for simplicity
            t[q] += 1  # RX
    return {"depth": int(t.max()), "cx": 2 * len(edges) * p, "rzz": len(edges) * p,
            "one_qubit": n + p * (n_h + n)}


def build_qiskit_circuit(model: Model, params, p, measure=True):
    sim_scale = float(max(np.abs(model.h).max(), np.abs(model.J).max(), 1e-12))
    n = model.n_qubits
    qc = QuantumCircuit(n, n if measure else 0)
    qc.h(range(n))
    g, b = params[:p], params[p:]
    for k in range(p):
        for i in range(n):
            for j in range(i + 1, n):
                if abs(model.J[i, j]) > 1e-12:
                    qc.rzz(2 * g[k] * model.J[i, j] / sim_scale, i, j)
        for i in range(n):
            if abs(model.h[i]) > 1e-12:
                qc.rz(2 * g[k] * model.h[i] / sim_scale, i)
        for i in range(n):
            qc.rx(2 * b[k], i)
    if measure:
        qc.measure(range(n), range(n))
    return qc


@lru_cache(maxsize=64)
def _transpiled_stats_cached(key, n, p, qasm_str):
    qc = QuantumCircuit.from_qasm_str(qasm_str)
    out = {}
    basis = ["cx", "rz", "sx", "x"]
    for name, cmap in [("all_to_all", None), ("linear", CouplingMap.from_line(n))]:
        tq = transpile(qc, basis_gates=basis, coupling_map=cmap, optimization_level=1, seed_transpiler=7)
        ops = tq.count_ops()
        out[name] = {"depth": int(tq.depth()), "cx": int(ops.get("cx", 0)),
                     "size": int(tq.size()), "ops": {k: int(v) for k, v in ops.items()}}
    return out


def circuit_report(model: Model, params, p):
    sim = QAOASim(model)
    n_h = int((np.abs(model.h) > 1e-12).sum())
    rep = {"n_qubits": model.n_qubits, "p": p,
           "analytic": analytic_circuit_stats(model.n_qubits, sim.edges, n_h, p),
           "n_zz_terms": len(sim.edges), "n_z_terms": n_h, "qiskit": HAVE_QISKIT}
    if HAVE_QISKIT:
        qc = build_qiskit_circuit(model, params, p)
        qasm = qasm2.dumps(qc)
        rep["qasm"] = qasm
        try:
            rep["transpiled"] = _transpiled_stats_cached(hash(qasm), model.n_qubits, p, qasm)
        except Exception as e:  # pragma: no cover
            rep["transpiled_error"] = str(e)
    return rep


def qiskit_crosscheck(model: Model, params, p) -> Optional[Dict]:
    if not HAVE_QISKIT:
        return None
    sim = QAOASim(model)
    psi = sim.state(np.asarray(params), p)
    t0 = time.perf_counter()
    sv = Statevector(build_qiskit_circuit(model, params, p, measure=False)).data
    rt = time.perf_counter() - t0
    fid = float(abs(np.vdot(sv, psi)) ** 2)
    return {"fidelity": fid, "max_prob_diff": float(np.abs(np.abs(sv) ** 2 - np.abs(psi) ** 2).max()),
            "qiskit_ms": 1000 * rt}


# ------------------------------------------------------------------ driver
def summarize_counts(model: Model, counts, optimum, opt_index, top=24):
    shots = int(counts.sum())
    fmask = feasible_mask(model)
    nz = np.nonzero(counts)[0]
    E = model.energies
    feas_shots = int(counts[fmask].sum())
    # "lowest-energy measured bitstring" → decoded allocation
    best_idx = int(nz[np.argmin(E[nz])])
    feas_nz = nz[fmask[nz]]
    best_feas = int(feas_nz[np.argmin(E[feas_nz])]) if feas_nz.size else None
    # allocation-level optimum probability (slack bits are bookkeeping only)
    opt_alloc = model.decode(opt_index)["alloc"]
    alloc_bits_mask = (1 << (2 * model.n_fac)) - 1
    opt_alloc_key = opt_index & alloc_bits_mask
    p_opt_alloc = float(counts[(np.arange(len(counts)) & alloc_bits_mask) == opt_alloc_key].sum() / shots)

    order = nz[np.argsort(-counts[nz])][:top]
    dist = []
    for i in order:
        d = model.decode(int(i))
        dist.append({"index": int(i), "bitstring": model.bitstring(int(i)), "count": int(counts[i]),
                     "prob": float(counts[i] / shots), "energy": float(E[i]), "feasible": bool(fmask[i]),
                     "alloc": d["alloc"], "optimal": bool(i == opt_index)})
    shot_energies = E[nz]
    w = counts[nz]
    mean_e = float((shot_energies * w).sum() / shots)
    return {
        "shots": shots,
        "feasibility_rate": feas_shots / shots,
        "p_opt": float(counts[opt_index] / shots),
        "p_opt_alloc": p_opt_alloc,
        "distinct": int(nz.size),
        "mean_energy": mean_e,
        "best_measured": describe_solution(model, best_idx, optimum),
        "best_feasible": describe_solution(model, best_feas, optimum) if best_feas is not None else None,
        "distribution": dist,
        "opt_alloc": opt_alloc,
    }


def run_qaoa(model: Model, optimum: float, opt_index: int, p=1, optimizer="COBYLA", init="interp",
             objective="expectation", alpha=0.2, restarts=2, maxiter=250, shots=2048, seed=0,
             noise: Optional[Dict] = None, crosscheck=True) -> Dict:
    sim = QAOASim(model)
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()
    opt = sim.optimize(p=p, optimizer=optimizer, init=init, objective=objective, alpha=alpha,
                       restarts=restarts, maxiter=maxiter, seed=seed)
    params = opt["params"]
    psi = sim.state(params, p)
    probs = np.abs(psi) ** 2
    fm = feasible_mask(model)
    alloc_mask = (1 << (2 * model.n_fac)) - 1
    opt_alloc_states = (np.arange(sim.N) & alloc_mask) == (opt_index & alloc_mask)
    ideal = {"expectation": sim.expectation(probs), "p_opt_exact": float(probs[opt_index]),
             "p_opt_alloc_exact": float(probs[opt_alloc_states].sum()),
             "feasible_mass": float(probs[fm].sum()),
             "uniform_feasible": float(fm.mean()), "uniform_p_opt": 1.0 / sim.N,
             "uniform_expectation": float(sim.E.mean()), "ground_energy": float(sim.E.min())}
    ideal["amplification_opt"] = ideal["p_opt_exact"] / ideal["uniform_p_opt"]
    ideal["amplification_feasible"] = ideal["feasible_mass"] / max(ideal["uniform_feasible"], 1e-12)

    counts = sim.sample(psi, shots, rng)
    clean = summarize_counts(model, counts, optimum, opt_index)
    total_ms = 1000 * (time.perf_counter() - t0)

    out = {
        "solver": "qaoa", "label": f"QAOA p={p}",
        "p": p, "optimizer": optimizer, "init": init, "objective": objective, "alpha": alpha,
        "gammas": params[:p].tolist(), "betas": params[p:].tolist(),
        "scale": sim.scale, "evaluations": sim.n_evals,
        "trace": _thin(opt["trace"], 300),
        "optimize_ms": opt["optimize_ms"], "runtime_ms": total_ms,
        "ideal": ideal, "sampled": clean,
        "solution": clean["best_measured"],
        "circuit": circuit_report(model, params, p),
        "evolution": sim.evolution(params, p),
    }
    if noise and noise.get("enabled"):
        t1 = time.perf_counter()
        ncounts, nexp, fid = sim.noisy_counts(params, p, shots, rng, e1=noise.get("e1", 0.001),
                                               e2=noise.get("e2", 0.01), ro=noise.get("readout", 0.02),
                                               trajectories=noise.get("trajectories", 64))
        noisy = summarize_counts(model, ncounts, optimum, opt_index)
        noisy["expectation"] = nexp
        noisy["est_fidelity"] = fid
        noisy["runtime_ms"] = 1000 * (time.perf_counter() - t1)
        out["noisy"] = noisy
        out["noise"] = noise
    if crosscheck:
        out["qiskit_check"] = qiskit_crosscheck(model, params, p)
    return out


def landscape(model: Model, res=36, objective="expectation", alpha=0.2):
    """p = 1 energy landscape  F(γ, β) = ⟨γ,β|H_C|γ,β⟩  on a grid."""
    sim = QAOASim(model)
    gs = np.linspace(0, math.pi, res)
    bs = np.linspace(-math.pi / 2, math.pi / 2, res)
    Z = np.zeros((res, res))
    for a, g in enumerate(gs):
        phase = np.exp(-1j * g * sim.Hn)
        for c, b in enumerate(bs):
            psi = np.full(sim.N, 1 / math.sqrt(sim.N), dtype=np.complex128) * phase
            psi = sim.mixer(psi, b)
            probs = np.abs(psi) ** 2
            Z[a, c] = sim.cvar(probs, alpha) if objective == "cvar" else sim.expectation(probs)
    k = np.unravel_index(np.argmin(Z), Z.shape)
    return {"gammas": gs.tolist(), "betas": bs.tolist(), "Z": Z.tolist(),
            "min": float(Z.min()), "max": float(Z.max()),
            "argmin": {"gamma": float(gs[k[0]]), "beta": float(bs[k[1]])},
            "e_ground": float(sim.E.min()), "e_mean": float(sim.E.mean())}


def _thin(seq: List, k: int):
    if len(seq) <= k:
        return seq
    idx = np.linspace(0, len(seq) - 1, k).astype(int)
    return [seq[i] for i in idx]
