import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============================================================================
// Types
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// In-Memory Data Store
// ============================================================================

export const tasks: Map<string, Task> = new Map();

// Seed some initial data
export const seedTasks = () => {
  const task1: Task = {
    id: uuidv4(),
    title: 'Setup project',
    description: 'Initialize the project structure and dependencies',
    status: 'completed',
    priority: 'high',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const task2: Task = {
    id: uuidv4(),
    title: 'Implement API',
    description: 'Create REST endpoints for the application',
    status: 'in_progress',
    priority: 'high',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const task3: Task = {
    id: uuidv4(),
    title: 'Write documentation',
    description: 'Document the API endpoints and usage',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  tasks.set(task1.id, task1);
  tasks.set(task2.id, task2);
  tasks.set(task3.id, task3);
};

// ============================================================================
// Task Endpoints
// ============================================================================

/**
 * @openapi
 * components:
 *   schemas:
 *     Task:
 *       type: object
 *       required:
 *         - id
 *         - title
 *         - status
 *         - priority
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique identifier
 *         title:
 *           type: string
 *           description: Task title
 *         description:
 *           type: string
 *           description: Task description
 *         status:
 *           type: string
 *           enum: [pending, in_progress, completed]
 *           description: Current status
 *         priority:
 *           type: string
 *           enum: [low, medium, high]
 *           description: Task priority
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     CreateTaskRequest:
 *       type: object
 *       required:
 *         - title
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, in_progress, completed]
 *           default: pending
 *         priority:
 *           type: string
 *           enum: [low, medium, high]
 *           default: medium
 *     UpdateTaskRequest:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, in_progress, completed]
 *         priority:
 *           type: string
 *           enum: [low, medium, high]
 */

/**
 * @openapi
 * /tasks:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Get all tasks
 *     description: Returns a list of all tasks
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high]
 *         description: Filter by priority
 *       - in: query
 *         name: delay
 *         schema:
 *           type: integer
 *         description: Optional delay in milliseconds before responding
 *     responses:
 *       200:
 *         description: List of tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *                 total:
 *                   type: integer
 */
router.get('/', async (req: Request, res: Response) => {
  let result = Array.from(tasks.values());
  
  const { status, priority, delay } = req.query;
  console.log('status', status);
  console.log('priority', priority);
  console.log('delay', delay);
  
  if (status) {
    result = result.filter(t => t.status === status);
  }
  
  if (priority) {
    result = result.filter(t => t.priority === priority);
  }
  if (delay) {
    console.log('waiting for delay', delay);
    await new Promise(resolve => setTimeout(resolve, Math.min(parseInt(delay as string), 100000))); // Max 10s delay
  }
  res.json({
    data: result,
    total: result.length,
  });
});

/**
 * @openapi
 * /tasks/html:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Get all tasks as HTML
 *     description: Returns an HTML page displaying all tasks
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high]
 *         description: Filter by priority
 *     responses:
 *       200:
 *         description: HTML page with tasks list
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
router.get('/html', (req: Request, res: Response) => {
  let result = Array.from(tasks.values());
  
  const { status, priority } = req.query;
  
  if (status) {
    result = result.filter(t => t.status === status);
  }
  
  if (priority) {
    result = result.filter(t => t.priority === priority);
  }

  const escapeHtml = (text: string): string => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, char => map[char]);
  };

  let cards = '';
  if (result.length === 0) {
    cards = `<div class="empty">No tasks found</div>`;
  } else {
    for (const task of result) {
      cards += `
        <div class="card">
          <div class="card-title">${escapeHtml(task.title)}</div>
          ${task.description ? `<p class="description">${escapeHtml(task.description)}</p>` : ''}
          <div class="card-meta">
            <span class="badge badge-${task.status}">${task.status.replace('_', ' ')}</span>
            <span class="badge badge-${task.priority}">${task.priority} priority</span>
            <span class="timestamp">Created: ${new Date(task.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      `;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tasks - Sample API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e4e4e7; min-height: 100vh; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 1.5rem; color: #f4f4f5; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; }
    .card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; transition: transform 0.2s, box-shadow 0.2s; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); }
    .card-title { font-size: 1.25rem; font-weight: 600; color: #f4f4f5; margin-bottom: 0.5rem; }
    .card-meta { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; text-transform: uppercase; }
    .badge-pending { background: #f59e0b; color: #1a1a2e; }
    .badge-in_progress { background: #3b82f6; color: #fff; }
    .badge-completed { background: #10b981; color: #fff; }
    .badge-low { background: #6b7280; color: #fff; }
    .badge-medium { background: #f59e0b; color: #1a1a2e; }
    .badge-high { background: #ef4444; color: #fff; }
    .description { color: #a1a1aa; font-size: 0.9rem; line-height: 1.5; }
    .timestamp { color: #71717a; font-size: 0.8rem; }
    .empty { text-align: center; padding: 3rem; color: #71717a; }
    .count { color: #71717a; font-size: 0.9rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Tasks</h1>
    <p class="count">${result.length} task${result.length !== 1 ? 's' : ''} found</p>
    ${cards}
  </div>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * @openapi
 * /tasks/{id}:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Get task by ID
 *     description: Returns a single task by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Task found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get('/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json(task);
});

/**
 * @openapi
 * /tasks:
 *   post:
 *     tags:
 *       - 1. Tasks
 *     summary: Create a new task
 *     description: Creates a new task with the provided data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTaskRequest'
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       400:
 *         description: Invalid request body
 */
router.post('/', (req: Request, res: Response) => {
  const { title, description = '', status = 'pending', priority = 'medium' } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const now = new Date().toISOString();
  const task: Task = {
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    createdAt: now,
    updatedAt: now,
  };
  
  tasks.set(task.id, task);
  res.status(201).json(task);
});

/**
 * @openapi
 * /tasks/{id}:
 *   put:
 *     tags:
 *       - 1. Tasks
 *     summary: Update a task
 *     description: Updates an existing task with the provided data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTaskRequest'
 *     responses:
 *       200:
 *         description: Task updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 */
router.put('/:id', (req: Request, res: Response) => {
  const task = tasks.get(req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const { title, description, status, priority } = req.body;
  
  const updatedTask: Task = {
    ...task,
    title: title ?? task.title,
    description: description ?? task.description,
    status: status ?? task.status,
    priority: priority ?? task.priority,
    updatedAt: new Date().toISOString(),
  };
  
  tasks.set(task.id, updatedTask);
  res.json(updatedTask);
});

/**
 * @openapi
 * /tasks/{id}:
 *   delete:
 *     tags:
 *       - 1. Tasks
 *     summary: Delete a task
 *     description: Deletes a task by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task ID
 *     responses:
 *       204:
 *         description: Task deleted successfully
 *       404:
 *         description: Task not found
 */
router.delete('/:id', (req: Request, res: Response) => {
  if (!tasks.has(req.params.id)) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  tasks.delete(req.params.id);
  res.status(204).send();
});

// ============================================================================
// Cookie Demonstration Endpoints
// ============================================================================

/**
 * @openapi
 * /tasks/cookies/demo:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Cookie demonstration endpoint
 *     description: Sets various cookies with different attributes to demonstrate cookie functionality
 *     responses:
 *       200:
 *         description: Cookies set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 cookiesSet:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       attributes:
 *                         type: object
 */
router.get('/cookies/demo', (req: Request, res: Response) => {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
  
  // Set various cookies with different attributes
  // 1. Simple session cookie (no expiration)
  res.cookie('session_id', uuidv4(), {
    httpOnly: true,
    secure: false, // Set to true in production with HTTPS
    sameSite: 'lax',
  });
  
  // 2. Cookie with expiration
  res.cookie('user_pref', 'dark_mode', {
    expires: expires,
    httpOnly: false, // Can be accessed by JavaScript
    secure: false,
    sameSite: 'strict',
  });
  
  // 3. Cookie with path restriction
  res.cookie('api_token', 'abc123xyz', {
    path: '/tasks',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    expires: expires,
  });
  
  // 4. Cookie with domain (if specified)
  const domain = req.hostname === 'localhost' ? undefined : '.echolon.app';
  if (domain) {
    res.cookie('shared_cookie', 'shared_value', {
      domain: domain,
      httpOnly: false,
      secure: true,
      sameSite: 'none',
      expires: expires,
    });
  }
  
  // 5. Secure cookie (should only be sent over HTTPS)
  res.cookie('secure_data', 'sensitive_info', {
    httpOnly: true,
    secure: true, // Only sent over HTTPS
    sameSite: 'strict',
    expires: expires,
  });
  
  res.json({
    message: 'Cookies have been set! Check the Cookies tab in the response viewer.',
    cookiesSet: [
      {
        name: 'session_id',
        attributes: {
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          expires: 'Session (no expiration)',
        },
      },
      {
        name: 'user_pref',
        attributes: {
          httpOnly: false,
          secure: false,
          sameSite: 'Strict',
          expires: expires.toUTCString(),
        },
      },
      {
        name: 'api_token',
        attributes: {
          path: '/tasks',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          expires: expires.toUTCString(),
        },
      },
      {
        name: 'secure_data',
        attributes: {
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
          expires: expires.toUTCString(),
        },
      },
    ],
    receivedCookies: req.cookies || {},
    receivedHeaders: req.headers.cookie || 'None',
  });
});

/**
 * @openapi
 * /tasks/cookies/check:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Check cookies sent with request
 *     description: Returns information about cookies that were sent with the request
 *     responses:
 *       200:
 *         description: Cookie information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cookies:
 *                   type: object
 *                   description: Parsed cookies from request
 *                 cookieHeader:
 *                   type: string
 *                   description: Raw Cookie header value
 */
router.get('/cookies/check', (req: Request, res: Response) => {
  res.json({
    message: 'These are the cookies that were sent with your request:',
    cookies: req.cookies || {},
    cookieHeader: req.headers.cookie || 'No Cookie header sent',
    parsedCookies: req.headers.cookie 
      ? req.headers.cookie.split(';').map(c => c.trim())
      : [],
  });
});

/**
 * @openapi
 * /tasks/cookies/login:
 *   post:
 *     tags:
 *       - 1. Tasks
 *     summary: Simulate login with session cookie
 *     description: Simulates a login endpoint that sets a session cookie
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, session cookie set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 sessionId:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/cookies/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  
  // Simple demo authentication (in real app, check against database)
  if (username === 'demo' && password === 'password') {
    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Set session cookie
    res.cookie('auth_session', sessionId, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      sameSite: 'lax',
      expires: expires,
      path: '/',
    });
    
    // Set user preference cookie
    res.cookie('username', username, {
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      expires: expires,
    });
    
    res.json({
      success: true,
      message: 'Login successful! Session cookie has been set.',
      sessionId: sessionId,
      expires: expires.toUTCString(),
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Invalid credentials. Try username: "demo", password: "password"',
    });
  }
});

/**
 * @openapi
 * /tasks/cookies/logout:
 *   post:
 *     tags:
 *       - 1. Tasks
 *     summary: Simulate logout by clearing session cookie
 *     description: Clears the authentication session cookie
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post('/cookies/logout', (req: Request, res: Response) => {
  // Clear session cookie by setting it to expire in the past
  res.clearCookie('auth_session');
  res.clearCookie('username');
  
  res.json({
    success: true,
    message: 'Logged out successfully. Session cookies have been cleared.',
  });
});

/**
 * @openapi
 * /tasks/cookies/protected:
 *   get:
 *     tags:
 *       - 1. Tasks
 *     summary: Protected route that requires session cookie
 *     description: Returns protected data if valid session cookie is present
 *     responses:
 *       200:
 *         description: Protected data returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized - no valid session cookie
 */
router.get('/cookies/protected', (req: Request, res: Response) => {
  const sessionId = req.cookies?.auth_session;
  
  if (!sessionId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. Please login first at POST /tasks/cookies/login',
      hint: 'Send a POST request to /tasks/cookies/login with {"username": "demo", "password": "password"}',
    });
  }
  
  res.json({
    success: true,
    message: 'Access granted! You have a valid session cookie.',
    data: {
      sessionId: sessionId,
      username: req.cookies?.username || 'unknown',
      protectedTasks: Array.from(tasks.values()).slice(0, 3),
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;

