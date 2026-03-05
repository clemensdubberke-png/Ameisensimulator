import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database import Goal, Commitment, Memory, SessionLocal, get_db, init_db
from claude_client import chat, proactive_check
from ntfy_client import send_notification
from scheduler_jobs import setup_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Database initialized")
    setup_scheduler(scheduler, SessionLocal)
    scheduler.start()
    logger.info("Scheduler started")
    yield
    scheduler.shutdown()
    logger.info("Scheduler stopped")


app = FastAPI(title="Proaktiver KI-Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")


# --- Request/Response Models ---

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str

class GoalCreate(BaseModel):
    title: str
    description: str = ""
    deadline: str | None = None

class GoalUpdate(BaseModel):
    status: str | None = None
    progress_notes: str | None = None


# --- Endpoints ---

@app.post("/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest, db: Session = Depends(get_db)):
    response_text = chat(req.message, db)
    return ChatResponse(response=response_text)


@app.get("/goals")
def get_goals(db: Session = Depends(get_db)):
    goals = db.query(Goal).order_by(Goal.created_at.desc()).all()
    return [
        {
            "id": g.id,
            "title": g.title,
            "description": g.description,
            "status": g.status,
            "deadline": g.deadline,
            "progress_notes": g.progress_notes,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
        for g in goals
    ]


@app.post("/goals")
def create_goal(goal: GoalCreate, db: Session = Depends(get_db)):
    new_goal = Goal(title=goal.title, description=goal.description, deadline=goal.deadline)
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    return {"id": new_goal.id, "title": new_goal.title, "status": new_goal.status}


@app.patch("/goals/{goal_id}")
def update_goal(goal_id: int, update: GoalUpdate, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        return {"error": "Goal not found"}
    if update.status is not None:
        goal.status = update.status
    if update.progress_notes is not None:
        goal.progress_notes = update.progress_notes
    db.commit()
    return {"id": goal.id, "status": goal.status}


@app.get("/commitments")
def get_commitments(db: Session = Depends(get_db)):
    commitments = db.query(Commitment).order_by(Commitment.due_date.asc()).all()
    return [
        {
            "id": c.id,
            "text": c.text,
            "due_date": c.due_date,
            "status": c.status,
            "follow_up_count": c.follow_up_count,
        }
        for c in commitments
    ]


@app.get("/memories")
def get_memories(db: Session = Depends(get_db)):
    memories = db.query(Memory).order_by(Memory.created_at.desc()).all()
    return [
        {
            "id": m.id,
            "key": m.key,
            "value": m.value,
            "category": m.category,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in memories
    ]


@app.post("/notify/test")
async def test_notification():
    agent_name = os.getenv("AGENT_NAME", "Agent")
    success = await send_notification(
        title=f"{agent_name} - Test",
        message="Push-Notification funktioniert!",
        force=True,
    )
    return {"success": success}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
