"""Mathematical model → QUBO → Ising.

Decision variables
------------------
For every facility f we use a 2-bit binary-encoded quantity

        a_f = x_{f,0} + 2·x_{f,1}          a_f ∈ {0, 1, 2, 3} units

and, when the total stock S can be exceeded, ⌈log2(S+1)⌉ slack bits s_j turn the
inequality  Σ_f a_f ≤ S  into the equality  Σ_f a_f + Σ_j 2^j s_j = S.

Objective + penalties (all quadratic in the bits)
-------------------------------------------------
    H = H_cost + λ1·H_capacity + λ2·H_demand + λ3·H_fairness + λ4·H_min-service

    H_cost        = Σ_f c_f · a_f
    H_demand      = Σ_f p_f · max(0, d_f − a_f)          (priority-weighted unmet demand)
    H_capacity    = Σ_f max(0, a_f − cap_f) + (Σ_f a_f + s − S)²
    H_fairness    = Σ_{f<g} (a_f/d_f − a_g/d_g)²          (coverage-ratio equity)
    H_min-service = Σ_f max(0, m_f − a_f)

Any function g(a_f) of one 2-bit register is *exactly* quadratic:
    g(a) = g0 + (g1−g0)·x0 + (g2−g0)·x1 + (g3−g2−g1+g0)·x0·x1
so the piece-wise terms above need no extra ancilla qubits.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np

from .scenario import BITS_PER_FACILITY, MAX_QUBITS, MAX_UNITS, Scenario

TERMS = ["cost", "capacity", "demand", "fairness", "min_service"]


class QuboBuilder:
    def __init__(self, n: int):
        self.Q = np.zeros((n, n))  # upper triangular, diagonal = linear terms
        self.c = 0.0

    def lin(self, i, v):
        self.Q[i, i] += v

    def quad(self, i, j, v):
        if i == j:
            self.Q[i, i] += v
        else:
            a, b = min(i, j), max(i, j)
            self.Q[a, b] += v

    def square(self, terms, const, w=1.0):
        """w · (Σ coef_i x_i + const)²  using x² = x."""
        for k, (i, a) in enumerate(terms):
            self.lin(i, w * (a * a + 2 * const * a))
            for (j, b) in terms[k + 1:]:
                self.quad(i, j, w * 2 * a * b)
        self.c += w * const * const

    def register_fn(self, i0, i1, g, w=1.0):
        g0, g1, g2, g3 = g
        self.c += w * g0
        self.lin(i0, w * (g1 - g0))
        self.lin(i1, w * (g2 - g0))
        self.quad(i0, i1, w * (g3 - g2 - g1 + g0))


@dataclass
class Model:
    scenario: Scenario
    n_fac: int
    n_slack: int
    n_qubits: int
    labels: List[str]
    Q: np.ndarray            # total upper-triangular QUBO (λ applied)
    const: float
    components: Dict[str, tuple] = field(default_factory=dict)  # term -> (Q, const) unweighted
    h: np.ndarray = None
    J: np.ndarray = None
    offset: float = 0.0
    _energies: np.ndarray = None
    _bits: np.ndarray = None

    # ---------------- energies over the full Hilbert space -----------------
    @property
    def bits(self) -> np.ndarray:
        if self._bits is None:
            idx = np.arange(1 << self.n_qubits, dtype=np.int64)
            self._bits = ((idx[:, None] >> np.arange(self.n_qubits)) & 1).astype(np.int8)
        return self._bits

    @property
    def energies(self) -> np.ndarray:
        if self._energies is None:
            self._energies = qubo_energy_all(self.Q, self.const, self.bits)
        return self._energies

    # ---------------- decoding ------------------------------------------
    def decode(self, index: int) -> Dict:
        x = [(index >> i) & 1 for i in range(self.n_qubits)]
        alloc = [x[2 * f] + 2 * x[2 * f + 1] for f in range(self.n_fac)]
        slack = sum(x[2 * self.n_fac + j] << j for j in range(self.n_slack))
        return {"x": x, "alloc": alloc, "slack": slack}

    def bitstring(self, index: int) -> str:
        # Qiskit convention: q_{n-1} … q_0
        return format(index, f"0{self.n_qubits}b")


def qubo_energy_all(Q, const, bits):
    b = bits.astype(np.float64)
    return np.einsum("si,ij,sj->s", b, Q, b, optimize=True) + const


def _ratio(a, d):
    return a / d if d > 0 else None


def build_model(sc: Scenario) -> Model:
    F = len(sc.facilities)
    max_total = MAX_UNITS * F
    n_slack = 0 if sc.supply >= max_total else max(1, math.ceil(math.log2(sc.supply + 1)))
    n = BITS_PER_FACILITY * F + n_slack
    if n > MAX_QUBITS:
        raise ValueError(f"Scenario needs {n} qubits; the interactive statevector limit is {MAX_QUBITS}.")

    labels = []
    for f, fac in enumerate(sc.facilities):
        labels += [f"x[{f},0]·1", f"x[{f},1]·2"]
    labels += [f"s[{j}]·{1 << j}" for j in range(n_slack)]

    comps = {t: QuboBuilder(n) for t in TERMS}
    for f, fac in enumerate(sc.facilities):
        i0, i1 = 2 * f, 2 * f + 1
        comps["cost"].register_fn(i0, i1, [fac.cost * a for a in range(4)])
        comps["demand"].register_fn(i0, i1, [fac.priority * max(0, fac.demand - a) for a in range(4)])
        comps["capacity"].register_fn(i0, i1, [max(0, a - fac.capacity) for a in range(4)])
        comps["min_service"].register_fn(i0, i1, [max(0, fac.min_service - a) for a in range(4)])

    if n_slack:  # total stock:  Σ a_f + Σ 2^j s_j − S = 0
        terms = [(2 * f, 1.0) for f in range(F)] + [(2 * f + 1, 2.0) for f in range(F)]
        terms += [(2 * F + j, float(1 << j)) for j in range(n_slack)]
        comps["capacity"].square(terms, -float(sc.supply))

    facs = [(f, fac) for f, fac in enumerate(sc.facilities) if fac.demand > 0]
    for (f, A), (g, B) in itertools.combinations(facs, 2):
        terms = [(2 * f, 1 / A.demand), (2 * f + 1, 2 / A.demand),
                 (2 * g, -1 / B.demand), (2 * g + 1, -2 / B.demand)]
        comps["fairness"].square(terms, 0.0)

    lam = sc.lambdas
    w = {"cost": 1.0, "capacity": lam.capacity, "demand": lam.demand,
         "fairness": lam.fairness, "min_service": lam.min_service}
    Q = sum(w[t] * comps[t].Q for t in TERMS)
    const = sum(w[t] * comps[t].c for t in TERMS)

    m = Model(scenario=sc, n_fac=F, n_slack=n_slack, n_qubits=n, labels=labels,
              Q=Q, const=const, components={t: (comps[t].Q, comps[t].c) for t in TERMS})
    m.h, m.J, m.offset = qubo_to_ising(Q, const)
    return m


def qubo_to_ising(Q, const):
    """x_i = (1 − z_i)/2  →  H = Σ h_i z_i + Σ_{i<j} J_ij z_i z_j + offset."""
    n = Q.shape[0]
    d = np.diag(Q).copy()
    U = np.triu(Q, 1)
    S = U + U.T
    h = -d / 2 - S.sum(axis=1) / 4
    J = U / 4
    offset = const + d.sum() / 2 + U.sum() / 4
    return h, J, offset


# ---------------------------------------------------------------- evaluation
def objective_of_alloc(sc: Scenario, alloc) -> Dict[str, float]:
    lam = sc.lambdas
    cost = sum(f.cost * a for f, a in zip(sc.facilities, alloc))
    unmet = sum(f.priority * max(0, f.demand - a) for f, a in zip(sc.facilities, alloc))
    ratios = [a / f.demand for f, a in zip(sc.facilities, alloc) if f.demand > 0]
    fair = sum((r1 - r2) ** 2 for r1, r2 in itertools.combinations(ratios, 2))
    total = cost + lam.demand * unmet + lam.fairness * fair
    return {"cost": cost, "unmet_weighted": unmet, "fairness": fair, "objective": total}


