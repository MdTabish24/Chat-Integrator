# Multi-Platform Messaging Hub

A unified inbox system that aggregates messages from multiple social media and communication platforms into a single interface.

## Supported Platforms

- Telegram
- Twitter/X
- LinkedIn
- Instagram Business
- WhatsApp Business
- Facebook Pages
- Microsoft Teams

## Tech Stack

### Backend
- Node.js with Express.js
- TypeScript
- PostgreSQL (with pgcrypto for encryption)
- Redis (for caching and job queues)
- Socket.io (for real-time updates)
- Bull (for job queues)

### Frontend
- React 18+ with TypeScript
- Tailwind CSS
- Socket.io-client
- React Query
- Axios

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Git

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd multi-platform-messaging-hub
```

### 2. Install dependencies

```bash
npm run install:all
```

This will install dependencies for the root project, backend, and frontend.

### 3. Set up environment variables

#### Backend
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and configure:
- Database credentials
- Redis configuration
- JWT secrets
- Platform API keys (Telegram, Twitter, LinkedIn, etc.)
- Encryption key (32 characters)

#### Frontend
```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env` and configure:
- API base URL (default: http://localhost:3000)

### 4. Start services with Docker

```bash
npm run docker:up
```

This will start:
- PostgreSQL database (port 5432)
- Redis (port 6379)
- Backend API (port 3000)
- Frontend dev server (port 5173)

### 5. Access the application

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health check: http://localhost:3000/health

## Development

### Run backend only
```bash
npm run dev:backend
```

### Run frontend only
```bash
npm run dev:frontend
```

### Run both (requires concurrently)
```bash
npm run dev
```

### Linting
```bash
npm run lint
```

### Format code
```bash
npm run format
```

### Type checking
```bash
npm run type-check
```

## Docker Commands

### Start all services
```bash
npm run docker:up
```

### Stop all services
```bash
npm run docker:down
```

### View logs
```bash
npm run docker:logs
```

### Rebuild containers
```bash
docker-compose up --build
```

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── config/          # Database, Redis configuration
│   │   ├── middleware/      # Express middleware
│   │   ├── types/           # TypeScript type definitions
│   │   ├── utils/           # Utility functions (encryption, etc.)
│   │   └── index.ts         # Application entry point
│   ├── db/
│   │   └── init.sql         # Database initialization script
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── config/          # API client configuration
│   │   ├── types/           # TypeScript type definitions
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml
├── package.json
└── README.md
```

## Database Schema

The database includes the following tables:
- `users` - User accounts
- `connected_accounts` - Connected social media accounts
- `conversations` - Message conversations
- `messages` - Individual messages
- `api_usage_logs` - API usage tracking

See `backend/db/init.sql` for the complete schema.

## Security

- All sensitive data (tokens, messages) is encrypted at rest using AES-256
- JWT tokens for authentication with 15-minute expiry
- Refresh tokens with 7-day expiry
- HTTPS enforced in production
- Rate limiting: 100 requests/minute per user
- Webhook signature validation for all platforms

## API Documentation

### Health Check
```
GET /health
```

Returns the status of the application and its dependencies.

### Authentication Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

### Platform Connection Endpoints
- `POST /api/auth/connect/:platform` - Initiate OAuth flow
- `GET /api/auth/callback/:platform` - OAuth callback handler
- `GET /api/auth/accounts` - List connected accounts
- `DELETE /api/auth/disconnect/:accountId` - Disconnect account

### Message Endpoints
- `GET /api/messages` - Fetch all messages
- `GET /api/messages/:conversationId` - Get conversation thread
- `POST /api/messages/:conversationId/send` - Send message
- `PATCH /api/messages/:messageId/read` - Mark as read

### Conversation Endpoints
- `GET /api/conversations` - List all conversations

## Contributing

1. Create a feature branch
2. Make your changes
3. Run linting and type checking
4. Commit with descriptive messages
5. Push and create a pull request

## License

ISC
