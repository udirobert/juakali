# JuaKali Voice Agent

An autonomous AI agent that manages an apprenticeship matching platform for Kenya's informal sector ("Jua Kali"). Masters register via voice call, apprentices find matches via SMS/USSD, and the agent handles the full lifecycle — powered by Gemini on Google Cloud.

Built for the [Google Cloud Rapid Agent Hackathon](https://rapid-agent.devpost.com/) and the [Gemini X Prize](https://www.geminixprize.com/).

## How It Works

1. **Master Registration (Voice)** — A skilled artisan calls a Twilio number, records their profile. Gemini transcribes the audio, extracts name/location/craft/skills, and creates a master profile.
2. **Apprentice Matching (SMS/USSD)** — An apprentice texts their location and desired craft. The agent reasons about the best matches and replies with ranked results.
3. **Confirmation Loop** — 48 hours after a match, both parties receive "Did you connect? 1=Yes 2=No". Confirmed matches boost the master's reputation score.
4. **Agent Chat** — A chat interface lets anyone interact with the JuaKali agent using natural language (register masters, find matches, check system status).

## Architecture

```
Twilio / Africa's Talking
        │
   Cloud Run (Agent Service)
   ├── Gemini 2.5 Flash (reasoning + function calling)
   ├── Webhook handlers (voice, SMS, USSD)
   └── Agent orchestration loop
        │
   MCP Server
   ├── Exposes tools: register-master, match, send-sms, etc.
   └── Works with any MCP client (Claude, Gemini, LangChain)
        │
   Convex Backend (Data Layer)
   ├── Realtime database
   ├── Cron jobs (SMS outbox, confirmation prompts)
   └── HTTP actions
        │
   Expo Frontend (Web + Mobile)
   ├── Onboarding flow (apprentice matching demo)
   ├── Agent chat (natural language interface)
   └── Admin dashboard (analytics, voice intake queue)
```

## Structure

```
├── apps/
│   └── default/              # Expo universal app (iOS, Android, Web)
│       ├── app/              # Expo Router screens
│       └── components/
│           └── jua-kali/     # Onboarding, AgentChat, AdminDashboard
│
├── packages/
│   ├── backend/              # Convex backend
│   │   └── convex/
│   │       ├── schema.ts         # Database schema
│   │       ├── telephony.ts      # Voice/SMS/USSD handlers + matching
│   │       ├── voiceProcessing.ts # Gemini transcription + extraction
│   │       ├── smsDelivery.ts    # SMS outbox with retry/backoff
│   │       ├── http.ts           # HTTP webhook endpoints
│   │       └── crons.ts          # Scheduled tasks
│   │
│   ├── agent/                # Cloud Run agent service
│   │   ├── src/
│   │   │   ├── index.ts          # Express server
│   │   │   ├── agent.ts          # Gemini function-calling agent loop
│   │   │   └── routes/           # Voice, SMS, USSD webhook routes
│   │   └── Dockerfile
│   │
│   └── mcp-server/           # MCP server (Model Context Protocol)
│       └── src/
│           ├── index.ts          # MCP server entry (stdio)
│           ├── tools.ts          # Agent tool definitions
│           └── backend-client.ts # Convex HTTP client
│
├── assets/                   # Shared images and fonts
├── .env                      # Environment variables
├── package.json              # Bun workspaces
└── turbo.json                # Turborepo tasks
```

## Getting Started

### 1. Install dependencies

```bash
bun install
```

### 2. Set up environment variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

Required variables:

| Variable | Purpose | Get From |
|---|---|---|
| `GOOGLE_API_KEY` | Gemini API for transcription + agent | [AI Studio](https://aistudio.google.com/apikey) |
| `CONVEX_DEPLOYMENT` | Convex deployment name | `bunx convex dev` output |
| `EXPO_PUBLIC_CONVEX_URL` | Convex cloud URL | `bunx convex dev` output |
| `EXPO_PUBLIC_CONVEX_SITE_URL` | Convex site URL | `bunx convex dev` output |
| `EXPO_PUBLIC_AGENT_URL` | Agent service URL | Default: `http://localhost:8080` |
| `CONVEX_SITE_URL` | Backend URL for agent service | Default: `http://localhost:3210` |

### 3. Run the stack

Run all three services:

```bash
# Terminal 1: Convex backend
cd packages/backend && bun run dev

# Terminal 2: Agent service
cd packages/agent && bun run dev

# Terminal 3: Frontend
cd apps/default && bun run start
```

Or run backend + frontend together via Turbo:

```bash
bun run dev
```

### 4. Seed demo data

From the frontend onboarding flow or admin dashboard, tap "Seed demo village" to populate 4 sample master artisans across Kenya.

## Deploying the Agent to Cloud Run

```bash
cd packages/agent

# Build and push to Google Cloud
gcloud builds submit --tag gcr.io/YOUR_PROJECT/juakali-agent

# Deploy to Cloud Run
gcloud run deploy juakali-agent \
  --image gcr.io/YOUR_PROJECT/juakali-agent \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=your-key,CONVEX_SITE_URL=https://your-deployment.convex.site"
```

## Running the MCP Server

```bash
cd packages/mcp-server
bun run dev
```

The MCP server runs on stdio. Configure it in any MCP-compatible client:

```json
{
  "mcpServers": {
    "juakali": {
      "command": "bun",
      "args": ["run", "dev"],
      "cwd": "/path/to/packages/mcp-server",
      "env": {
        "JUAKALI_BACKEND_URL": "https://your-deployment.convex.site"
      }
    }
  }
}
```

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Gemini 2.5 Flash (function calling, multimodal) |
| Agent Hosting | Google Cloud Run |
| Agent Protocol | Model Context Protocol (MCP) |
| Backend | Convex (realtime DB + serverless functions) |
| Telephony | Twilio / Africa's Talking |
| Frontend | Expo + React Native (universal: iOS, Android, Web) |
| Monorepo | Turborepo + Bun workspaces |

## Common Crafts

Carpentry, welding, tailoring, mechanics, masonry, plumbing, electrical, hairdressing, painting, metalwork, woodwork, shoemaking.
