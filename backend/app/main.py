"""FastAPI backend for the Hybrid Quantum-Classical Healthcare Resource
Optimisation demo.  Also serves the 3D frontend from ../../frontend."""
from __future__ import annotations

import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import qaoa as Q
from .benchmark import run_benchmark
from .qubo import build_model, describe_solution, model_payload, suggest_penalties
from .scenario import MAX_QUBITS, PRESETS, Scenario
from .solvers import encode_alloc, exact, greedy, simulated_annealing

app = FastAPI(title="Hybrid Quantum-Classical Healthcare Optimiser (QAOA)", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


class Noise(BaseModel):
    enabled: bool = False
    e1: float = Field(default=0.001, ge=0, le=0.2)
    e2: float = Field(default=0.01, ge=0, le=0.3)
    readout: float = Field(default=0.02, ge=0, le=0.3)
    trajectories: int = Field(default=64, ge=4, le=256)


class QAOAReq(BaseModel):
    scenario: Scenario
    p: int = Field(default=1, ge=1, le=6)
    optimizer: str = "COBYLA"
    init: str = "interp"
    objective: str = "cvar"
    alpha: float = Field(default=0.25, gt=0, le=1)
    restarts: int = Field(default=2, ge=1, le=8)
    maxiter: int = Field(default=250, ge=10, le=2000)
    shots: int = Field(default=2048, ge=64, le=20000)
    seed: int = 0
    noise: Noise = Noise()


class SAReq(BaseModel):
    scenario: Scenario
    seed: int = 0
    sweeps: int = Field(default=2500, ge=50, le=20000)
    restarts: int = Field(default=12, ge=1, le=50)


class LandscapeReq(BaseModel):
    scenario: Scenario
    resolution: int = Field(default=36, ge=8, le=80)
    objective: str = "cvar"
    alpha: float = Field(default=0.25, gt=0, le=1)


class BenchReq(BaseModel):
    scenario: Scenario
    seeds: List[int] = [0, 1, 2]
    p_list: List[int] = [1, 2, 3]
    shots: int = 1024
    objective: str = "cvar"
    alpha: float = 0.25
    noise: Noise = Noise(enabled=True)


def _model(sc: Scenario):
    try:
        return build_model(sc)
    except ValueError as e:
        raise HTTPException(400, str(e))


def _exact(m):
    ex = exact(m)
    if ex.get("infeasible_problem"):
        raise HTTPException(422, ex["message"])
    return ex


@app.get("/api/health")
def health():
    return {"ok": True, "qiskit": Q.HAVE_QISKIT, "max_qubits": MAX_QUBITS,
            "qiskit_version": __import__("qiskit").__version__ if Q.HAVE_QISKIT else None}


@app.get("/api/presets")
def presets():
    return {k: v.model_dump() for k, v in PRESETS.items()}


@app.post("/api/model")
def model(sc: Scenario):
    t0 = time.perf_counter()
    m = _model(sc)
    out = model_payload(m)
    out["build_ms"] = 1000 * (time.perf_counter() - t0)
    return out


@app.post("/api/suggest_penalties")
def suggest(sc: Scenario):
    return suggest_penalties(sc)


@app.post("/api/solve/exact")
def solve_exact(sc: Scenario):
    return _exact(_model(sc))


@app.post("/api/solve/greedy")
def solve_greedy(sc: Scenario):
    m = _model(sc)
    return greedy(m, _exact(m)["optimum"])


@app.post("/api/solve/sa")
def solve_sa(r: SAReq):
    m = _model(r.scenario)
    return simulated_annealing(m, seed=r.seed, sweeps=r.sweeps, restarts=r.restarts,
                               optimum=_exact(m)["optimum"])


@app.post("/api/solve/qaoa")
def solve_qaoa(r: QAOAReq):
    if r.optimizer not in ("COBYLA", "Nelder-Mead", "Powell"):
        raise HTTPException(400, "optimizer must be COBYLA, Nelder-Mead or Powell")
    m = _model(r.scenario)
    ex = _exact(m)
    opt_idx = encode_alloc(m, ex["solution"]["alloc"])
    return Q.run_qaoa(m, ex["optimum"], opt_idx, p=r.p, optimizer=r.optimizer, init=r.init,
                      objective=r.objective, alpha=r.alpha, restarts=r.restarts, maxiter=r.maxiter,
                      shots=r.shots, seed=r.seed, noise=r.noise.model_dump())


@app.post("/api/landscape")
def qaoa_landscape(r: LandscapeReq):
    m = _model(r.scenario)
    return Q.landscape(m, res=r.resolution, objective=r.objective, alpha=r.alpha)


@app.post("/api/benchmark")
def benchmark(r: BenchReq):
    m = _model(r.scenario)
    t0 = time.perf_counter()
    out = run_benchmark(m, seeds=tuple(r.seeds[:5]), p_list=tuple(x for x in r.p_list if 1 <= x <= 4),
                        noise=r.noise.model_dump(), shots=r.shots, objective=r.objective, alpha=r.alpha)
    if "error" in out:
        raise HTTPException(422, out["error"])
    out["total_ms"] = 1000 * (time.perf_counter() - t0)
    return out


# ----------------------------------------------------------------- frontend
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND / "index.html")
