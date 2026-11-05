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


