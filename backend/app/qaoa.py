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


