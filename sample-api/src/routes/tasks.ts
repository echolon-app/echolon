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

export default router;

