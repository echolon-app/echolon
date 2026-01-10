# Echolon API Server

A comprehensive backend service for Echolon that handles:
- WebSocket-based proxy routing from `*.echolon.app` subdomains to connected clients
- User authentication (email/password + OAuth)
- Subscription management with Stripe billing
- Team/seat management for Business and Enterprise plans

## Architecture

```
External Client → test.echolon.app → API Server → WebSocket → Electron Client
                                                ↓
                                   (Optional) Forward to api.example.com

Electron App/Web/Landing → api.echolon.app → Auth/Subscriptions/Teams → MySQL DB
                                           ↓
                                         Stripe
```

## Features

### Proxy Service
- **Dynamic Subdomain Routing**: Each connected client registers a namespace (e.g., `test` for `test.echolon.app`)
- **WebSocket Communication**: Real-time bidirectional communication with Echolon clients
- **Request/Response Forwarding**: Forward requests to connected clients and return their responses

### Authentication
- Email/password registration with email verification
- OAuth support (Google, GitHub)
- JWT-based session management

### Subscriptions
- Three tiers: Personal (free), Pro ($9/user/mo), Enterprise ($19/user/mo)
- Stripe checkout and billing portal integration
- Webhook handling for subscription events

### Team Management
- Create and manage teams
- Invite users via email
- Role-based access control (owner, admin, member)
- Seat management for paid plans

## Development

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- npm or yarn

### Setup

```bash
cd api
npm install
cp .env.example .env
# Edit .env with your configuration
```

### Running Locally

```bash
npm run dev
```

The server will start on `http://localhost:3500`.

### Building

```bash
npm run build
```

## API Endpoints

### Internal (Proxy)
- `GET /_internal/health` - Health check endpoint
- `GET /_internal/version` - Server version
- `GET /_internal/namespaces` - List connected namespaces
- `GET /_internal/check/:namespace` - Check namespace availability

### Authentication
- `POST /api/auth/register` - Register with email/password
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/verify-email` - Verify email token
- `GET /api/auth/me` - Get current user
- `GET /api/auth/oauth/:provider` - OAuth redirect
- `GET /api/auth/oauth/:provider/callback` - OAuth callback

### Subscriptions
- `GET /api/plans` - Get all pricing plans
- `GET /api/subscriptions` - Get user's subscription
- `POST /api/subscriptions/checkout` - Create Stripe checkout session
- `POST /api/subscriptions/portal` - Create Stripe billing portal
- `POST /api/webhooks/stripe` - Stripe webhook handler

### Teams
- `GET /api/teams` - List user's teams
- `POST /api/teams` - Create a team
- `GET /api/teams/:id` - Get team details
- `PUT /api/teams/:id` - Update team
- `DELETE /api/teams/:id` - Delete team
- `GET /api/teams/:id/members` - List team members
- `POST /api/teams/:id/members` - Add team member
- `DELETE /api/teams/:id/members/:userId` - Remove team member
- `GET /api/teams/:id/invitations` - List pending invitations
- `POST /api/teams/:id/invitations` - Send invitation
- `DELETE /api/teams/:id/invitations/:id` - Cancel invitation
- `POST /api/invitations/:token/accept` - Accept invitation

### WebSocket

Connect to `/ws` and send messages:

```json
// Register a namespace
{ "type": "register", "namespace": "test", "forwardTo": "https://api.example.com" }

// Response to an incoming request
{ "type": "response", "id": "request-uuid", "status": 200, "headers": {...}, "body": "..." }
```

## Environment Variables

See `.env.example` for all required environment variables.

## Deployment

### EC2 Setup

1. Launch an EC2 instance (Amazon Linux 2, t3.small or similar)
2. Install Node.js 18+, MySQL 8.0+, and PM2
3. Configure Nginx with SSL (wildcard certificate for `*.echolon.app`)
4. Set up environment variables
5. Run deployment:

```bash
npm run deploy
```

### PM2 Commands

```bash
pm2 logs echolon-api      # View logs
pm2 restart echolon-api   # Restart
pm2 stop echolon-api      # Stop
pm2 status                # Status
```

## Security Notes

- The API server should be behind Nginx with SSL termination
- Use wildcard SSL certificate for `*.echolon.app`
- JWT tokens expire after 7 days
- Rate limiting is enabled on auth endpoints
- Stripe webhooks are verified with signing secret
