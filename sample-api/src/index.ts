import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerJsdoc from 'swagger-jsdoc';
import { v4 as uuidv4 } from 'uuid';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { version } from '../package.json';

// Import routes
import authRoutes from './routes/auth';
import awsSigRoutes from './routes/AWSSig';
import usersRoutes, { users, seedUsers, User } from './routes/users';
import tasksRoutes, { tasks, seedTasks, Task } from './routes/tasks';
import healthRoutes, { echoHandler } from './routes/health';
import { startWebSocketServer } from './websocket';

// Generate HTML for Echolon Web API Reference
function generateEcholonWebHtml(options: {
  title: string;
  description: string;
  specUrl: string;
}): string {
  const { title, description, specUrl } = options;
  
  // Use CDN for Echolon Web assets
  const WEB_ECHOLON_BASE = 'https://echolon-web.s3.eu-central-1.amazonaws.com';
  const SCRIPT_URL = `${WEB_ECHOLON_BASE}/assets/index-latest.js`;
  const CSS_URL = `${WEB_ECHOLON_BASE}/assets/index-latest.css`;
  
  const escapeHtml = (text: string): string => {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
  };
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(description || `API documentation for ${title}`)}">
  <title>${escapeHtml(title)} - API Reference</title>
  
  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="${WEB_ECHOLON_BASE}/favicon.svg">
  
  <!-- Echolon Web Styles -->
  <link rel="stylesheet" href="${CSS_URL}">
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      height: 100%; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }
    #echolon { height: 100%; }
    
    /* Loading state */
    .echolon-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      background: #0a0a0a;
      color: #e5e5e5;
    }
    .echolon-loading__spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #262626;
      border-top-color: #22c55e;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .echolon-loading p {
      margin-top: 16px;
      font-size: 14px;
      opacity: 0.7;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div id="echolon">
    <div class="echolon-loading">
      <div class="echolon-loading__spinner"></div>
      <p>Loading API documentation...</p>
    </div>
  </div>
  
  <!-- Echolon Web Configuration -->
  <script
    id="api-reference"
    data-url="${specUrl}"
    data-theme="dark"
    data-view="reference"
    data-readonly="true"
    data-title="${escapeHtml(title)}"
  ></script>
  
  <!-- Echolon Web Script -->
  <script type="module" src="${SCRIPT_URL}"></script>
</body>
</html>`;
}

const app = express();
const PORT = process.env.PORT || 3501;
const WS_PORT = process.env.WS_PORT || 3502;

// CORS configuration
const corsOptions = {
  origin: [
    'https://web.echolon.app',
    'http://localhost:5174',
  ],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Seed data
seedUsers();
seedTasks();

// ============================================================================
// GraphQL Schema & Resolvers
// ============================================================================

const typeDefs = `#graphql
  enum TaskStatus {
    pending
    in_progress
    completed
  }

  enum TaskPriority {
    low
    medium
    high
  }

  enum UserRole {
    admin
    user
    guest
  }

  type Task {
    id: ID!
    title: String!
    description: String
    status: TaskStatus!
    priority: TaskPriority!
    createdAt: String!
    updatedAt: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    role: UserRole!
    createdAt: String!
  }

  type TasksResponse {
    data: [Task!]!
    total: Int!
  }

  type UsersResponse {
    data: [User!]!
    total: Int!
  }

  input CreateTaskInput {
    title: String!
    description: String
    status: TaskStatus
    priority: TaskPriority
  }

  input UpdateTaskInput {
    title: String
    description: String
    status: TaskStatus
    priority: TaskPriority
  }

  input CreateUserInput {
    name: String!
    email: String!
    role: UserRole
  }

  input UpdateUserInput {
    name: String
    email: String
    role: UserRole
  }

  type Query {
    # Task queries
    tasks(status: TaskStatus, priority: TaskPriority): TasksResponse!
    task(id: ID!): Task

    # User queries
    users(role: UserRole): UsersResponse!
    user(id: ID!): User

    # Health check
    health: HealthStatus!
  }

  type HealthStatus {
    status: String!
    timestamp: String!
    uptime: Float!
  }

  type Mutation {
    # Task mutations
    createTask(input: CreateTaskInput!): Task!
    updateTask(id: ID!, input: UpdateTaskInput!): Task
    deleteTask(id: ID!): Boolean!

    # User mutations
    createUser(input: CreateUserInput!): User!
    updateUser(id: ID!, input: UpdateUserInput!): User
    deleteUser(id: ID!): Boolean!
  }
`;

const resolvers = {
  Query: {
    // Task queries
    tasks: (_: unknown, { status, priority }: { status?: string; priority?: string }) => {
      let result = Array.from(tasks.values());
      
      if (status) {
        result = result.filter(t => t.status === status);
      }
      if (priority) {
        result = result.filter(t => t.priority === priority);
      }
      
      return { data: result, total: result.length };
    },
    
    task: (_: unknown, { id }: { id: string }) => {
      return tasks.get(id) || null;
    },

    // User queries
    users: (_: unknown, { role }: { role?: string }) => {
      let result = Array.from(users.values());
      
      if (role) {
        result = result.filter(u => u.role === role);
      }
      
      return { data: result, total: result.length };
    },
    
    user: (_: unknown, { id }: { id: string }) => {
      return users.get(id) || null;
    },

    // Health check
    health: () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }),
  },

  Mutation: {
    // Task mutations
    createTask: (_: unknown, { input }: { input: { title: string; description?: string; status?: string; priority?: string } }) => {
      const now = new Date().toISOString();
      const task: Task = {
        id: uuidv4(),
        title: input.title,
        description: input.description || '',
        status: (input.status as Task['status']) || 'pending',
        priority: (input.priority as Task['priority']) || 'medium',
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(task.id, task);
      return task;
    },

    updateTask: (_: unknown, { id, input }: { id: string; input: { title?: string; description?: string; status?: string; priority?: string } }) => {
      const task = tasks.get(id);
      if (!task) return null;

      const updatedTask: Task = {
        ...task,
        title: input.title ?? task.title,
        description: input.description ?? task.description,
        status: (input.status as Task['status']) ?? task.status,
        priority: (input.priority as Task['priority']) ?? task.priority,
        updatedAt: new Date().toISOString(),
      };

      tasks.set(id, updatedTask);
      return updatedTask;
    },

    deleteTask: (_: unknown, { id }: { id: string }) => {
      if (!tasks.has(id)) return false;
      tasks.delete(id);
      return true;
    },

    // User mutations
    createUser: (_: unknown, { input }: { input: { name: string; email: string; role?: string } }) => {
      // Check for duplicate email
      const existingUser = Array.from(users.values()).find(u => u.email === input.email);
      if (existingUser) {
        throw new Error('Email already exists');
      }

      const user: User = {
        id: uuidv4(),
        name: input.name,
        email: input.email,
        role: (input.role as User['role']) || 'user',
        createdAt: new Date().toISOString(),
      };
      users.set(user.id, user);
      return user;
    },

    updateUser: (_: unknown, { id, input }: { id: string; input: { name?: string; email?: string; role?: string } }) => {
      const user = users.get(id);
      if (!user) return null;

      // Check for duplicate email if changing
      if (input.email && input.email !== user.email) {
        const existingUser = Array.from(users.values()).find(u => u.email === input.email);
        if (existingUser) {
          throw new Error('Email already exists');
        }
      }

      const updatedUser: User = {
        ...user,
        name: input.name ?? user.name,
        email: input.email ?? user.email,
        role: (input.role as User['role']) ?? user.role,
      };

      users.set(id, updatedUser);
      return updatedUser;
    },

    deleteUser: (_: unknown, { id }: { id: string }) => {
      if (!users.has(id)) return false;
      users.delete(id);
      return true;
    },
  },
};

// Create Apollo Server instance
const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true, // Enable introspection for development
});

// ============================================================================
// OpenAPI Configuration
// ============================================================================

// Determine the correct file to scan based on how we're running
// In dev mode (ts-node-dev): use src/*.ts
// In production (compiled): use dist/*.js
const isDevMode = __filename.endsWith('.ts');
const apiFiles = isDevMode 
  ? ['./src/index.ts', './src/routes/*.ts', './src/routes/**/*.ts'] 
  : ['./dist/index.js', './dist/routes/*.js', './dist/routes/**/*.js'];

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sample CRUD API',
      version: version,
      description: 'A sample API with Tasks and Users CRUD operations for testing Echolon import functionality!',
      contact: {
        name: 'API Support',
        email: 'support@echolon.app',
      },
    },
    servers: [
      {
        url: 'https://sample-api.echolon.app',
        description: 'Production server',
        'x-color': '#22c55e', 
      },
      {
        url: `http://localhost:${PORT}`,
        description: 'Dev server',
        'x-color': '#ef4444',
      },
    ],
    tags: [
      { name: '1. Tasks', description: 'Task management endpoints' },
      { name: '2. Users', description: 'User management endpoints' },
      { name: '3. Health', description: 'Health check endpoints' },
      { name: '4. Echo', description: 'Echo back request data for testing' },
      { name: '5. Authentication', description: 'Test various authentication methods' },
      { name: '6. Authentication/OAuth 2.0', description: 'OAuth 2.0 authentication endpoints' },
      { name: '7. Authentication/AWS Sig V4', description: 'AWS Signature Version 4 authentication endpoints' },
    ],
  },
  apis: apiFiles,
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Serve OpenAPI spec as JSON
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Serve Echolon Web API Reference
app.get('/docs', (_req: Request, res: Response) => {
  const spec = swaggerSpec as { info: { title: string; description?: string } };
  const html = generateEcholonWebHtml({
    title: spec.info.title,
    description: spec.info.description || '',
    specUrl: '/openapi.json',
  });
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ============================================================================
// REST Routes
// ============================================================================

// Health check
app.use('/health', healthRoutes);

// Echo endpoint (all methods)
app.all('/echo', echoHandler);

// Authentication routes
app.use('/auth', authRoutes);

// AWS Signature v4 authentication routes
app.use('/auth/aws-sig', awsSigRoutes);

// Task routes
app.use('/tasks', tasksRoutes);

// User routes
app.use('/users', usersRoutes);

// ============================================================================
// Error Handler
// ============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// Start Server (with Apollo GraphQL)
// ============================================================================

async function startServer() {
  // Start Apollo Server
  await apolloServer.start();

  // Mount GraphQL endpoint
  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(apolloServer, {
      context: async () => ({}),
    })
  );

  // Start WebSocket Echo Server
  startWebSocketServer(Number(WS_PORT));

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Sample CRUD API + GraphQL + WebSocket!          ║
╠══════════════════════════════════════════════════════════════╣
║  REST Server:          http://localhost:${PORT}                 ║
║  OpenAPI Spec:         http://localhost:${PORT}/openapi.json    ║
║  Swagger UI:           http://localhost:${PORT}/docs            ║
║  GraphQL Endpoint:     http://localhost:${PORT}/graphql         ║
║  WebSocket Echo:       ws://localhost:${WS_PORT}                  ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);

export default app;
