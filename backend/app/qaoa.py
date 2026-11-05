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

