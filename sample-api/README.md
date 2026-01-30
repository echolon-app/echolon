# Sample CRUD API

A simple REST API with Tasks and Users CRUD operations, designed for testing Echolon's OpenAPI and GraphQL import functionality.

## Features

- Full CRUD operations for Tasks and Users
- **REST API** with OpenAPI 3.0 documentation
- **GraphQL API** with full schema introspection
- **WebSocket Echo Server** - echoes back any message sent to it
- Swagger UI for interactive REST testing
- In-memory data store with seed data
- PM2 deployment configuration

## REST Endpoints

### Health
- `GET /health` - Health check

### Tasks
- `GET /tasks` - List all tasks (with optional `status` and `priority` filters)
- `GET /tasks/:id` - Get task by ID
- `POST /tasks` - Create a new task
- `PUT /tasks/:id` - Update a task
- `DELETE /tasks/:id` - Delete a task

### Users
- `GET /users` - List all users (with optional `role` filter)
- `GET /users/:id` - Get user by ID
- `POST /users` - Create a new user
- `PUT /users/:id` - Update a user
- `DELETE /users/:id` - Delete a user

## WebSocket Echo Server

The WebSocket echo server runs on port 3502 and echoes back any message you send to it. Similar to `wss://echo.websocket.org`.

**Endpoint**: `ws://localhost:3502`

### Behavior

1. **On Connect**: Sends a welcome message with your client ID
2. **On Message**: Echoes back your message with metadata (timestamp, client ID)
3. **JSON Messages**: Parsed and included in `originalMessage` field (objects, arrays, strings, numbers, etc.)
4. **Plain Text Messages**: Included as-is in `originalMessage` field
5. **Binary Messages**: Echoed back as raw binary data

### Message Format

**All messages are echoed back**, regardless of format:

**Response Format:**

Messages are echoed back as JSON:

```json
{
  "type": "echo",
  "originalMessage": "<your message or parsed JSON>",
  "clientId": "abc12345",
  "timestamp": "2026-01-02T12:00:00.000Z",
  "receivedAt": 1767367200000
}
```

**Examples:**

- Plain string `"hello"` → `{"type": "echo", "originalMessage": "hello", ...}`
- JSON object `{"key": "value"}` → `{"type": "echo", "originalMessage": {"key": "value"}, ...}`
- JSON array `[1, 2, 3]` → `{"type": "echo", "originalMessage": [1, 2, 3], ...}`
- JSON string `"\"hello\""` → `{"type": "echo", "originalMessage": "hello", ...}`

## GraphQL API

GraphQL endpoint: `POST /graphql`

### Queries
- `tasks(status, priority)` - List tasks with optional filters
- `task(id)` - Get single task by ID
- `users(role)` - List users with optional role filter
- `user(id)` - Get single user by ID
- `health` - Health check

### Mutations
- `createTask(input)` - Create a new task
- `updateTask(id, input)` - Update a task
- `deleteTask(id)` - Delete a task
- `createUser(input)` - Create a new user
- `updateUser(id, input)` - Update a user
- `deleteUser(id)` - Delete a user

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev
```

### Production

```bash
# Build
npm run build

# Start
npm start
```

### PM2 Deployment

```bash
# Build first
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Or for production
pm2 start ecosystem.config.js --env production

# View logs
pm2 logs sample-api

# Stop
pm2 stop sample-api

# Restart
pm2 restart sample-api
```

## URLs

Once running:

- **API Base**: http://localhost:3501
- **OpenAPI Spec**: http://localhost:3501/openapi.json
- **Swagger UI**: http://localhost:3501/docs
- **GraphQL Endpoint**: http://localhost:3501/graphql
- **WebSocket Echo**: ws://localhost:3502

## Testing with Echolon

### Import REST API (OpenAPI)
1. Start the sample API: `npm run dev`
2. In Echolon, go to Import Collection
3. Select "URL" tab
4. Enter: `http://localhost:3501/openapi.json`
5. Click "Fetch" to preview
6. Click "Import" to create the collection

### Import GraphQL API
1. Start the sample API: `npm run dev`
2. In Echolon, go to Import Collection
3. Select "GraphQL" tab
4. Enter: `http://localhost:3501/graphql`
5. Click "Fetch" to introspect the schema
6. Click "Import" to create the collection

## REST API Examples

### Create a Task

```bash
curl -X POST http://localhost:3501/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "My Task", "description": "Task description", "priority": "high"}'
```

### Get All Tasks

```bash
curl http://localhost:3501/tasks
```

### Filter Tasks by Status

```bash
curl http://localhost:3501/tasks?status=pending
```

## GraphQL API Examples

### Query All Tasks

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ tasks { data { id title status priority } total } }"}'
```

### Query Tasks with Filter

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ tasks(status: pending) { data { id title } } }"}'
```

### Create a Task (Mutation)

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { createTask(input: { title: \"New Task\", priority: high }) { id title createdAt } }"}'
```

### Update a Task (Mutation)

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { updateTask(id: \"TASK_ID\", input: { status: completed }) { id status updatedAt } }"}'
```

### Query Users

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ users { data { id name email role } total } }"}'
```

### Combined Query (Tasks, Users, and Health)

```bash
curl -X POST http://localhost:3501/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ tasks { total } users { total } health { status uptime } }"}'
```

## WebSocket Examples

### Using wscat

```bash
# Install wscat globally
npm install -g wscat

# Connect to the echo server
wscat -c ws://localhost:3502

# Then type messages and see them echoed back
```

### Using Node.js

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3502');

ws.on('open', () => {
  console.log('Connected!');
  ws.send('Hello, WebSocket!');
  ws.send(JSON.stringify({ test: 'message', number: 42 }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});
```

### Using JavaScript in Browser

```javascript
const ws = new WebSocket('ws://localhost:3502');

ws.onopen = () => {
  console.log('Connected!');
  ws.send('Hello from browser!');
};

ws.onmessage = (event) => {
  console.log('Received:', event.data);
};
```

