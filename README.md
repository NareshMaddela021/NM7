# Nm7 (nm7.si)

Resume services by **AsuraaX AI** — free ATS scan, resume builder, verified expert rewrites, customer dashboard, expert workspace and admin console.

| Folder | What | Status |
|---|---|---|
| `frontend/` | React 18 + Vite app (all screens) | Built — runs on sample data |
| `backend/` | FastAPI + MongoDB Atlas (auth, orders, Razorpay, notifications) | In progress — see [`backend/PLAN.md`](backend/PLAN.md) |

## Run the frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in frontend/dist
```
Details, settings and what's left: see [`frontend/README.md`](frontend/README.md).

## Branches
- `main` — what goes live
- `dev` — work in progress; merge into `main` when tested
