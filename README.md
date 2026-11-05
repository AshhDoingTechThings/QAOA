# QAOA Health Optimiser

**Hybrid Quantum-Classical Framework for Healthcare Resource Optimization using QAOA**
Team 09 · Vidya Jyothi Institute of Technology, Department of AI
Guide: Dr K Venkata Subba Reddy · Namani Yashaswini (23911A3541) · Syed Asif (23911A3559)

An end-to-end, demonstrable implementation of the Review-1 design. A configurable
healthcare allocation scenario is turned into a **QUBO** and then an **Ising
Hamiltonian**. That model is solved with **exact enumeration**, **classical
baselines** and **QAOA** (ideal and noisy), and the results are benchmarked on
quality, feasibility, runtime, stability, qubits and circuit depth. An interactive
**3D dashboard** presents each step.

```
Scenario → Mathematical model → QUBO → Ising → { Exact | Classical | QAOA (Qiskit) } → Benchmark → Dashboard
```

