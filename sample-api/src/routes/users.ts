import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: string;
}

// ============================================================================
// In-Memory Data Store
// ============================================================================

export const users: Map<string, User> = new Map();

// Seed some initial data
export const seedUsers = () => {
  const user1: User = {
    id: uuidv4(),
    name: 'John Doe',
    email: 'john@example.com',
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  const user2: User = {
    id: uuidv4(),
    name: 'Jane Smith',
    email: 'jane@example.com',
    role: 'user',
    createdAt: new Date().toISOString(),
  };

  users.set(user1.id, user1);
  users.set(user2.id, user2);
};

// ============================================================================
// User Endpoints
// ============================================================================

/**
 * @openapi
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - email
 *         - role
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique identifier
 *         name:
 *           type: string
 *           description: User's full name
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         role:
 *           type: string
 *           enum: [admin, user, guest]
 *           description: User's role
 *         createdAt:
 *           type: string
 *           format: date-time
 *     CreateUserRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role:
 *           type: string
 *           enum: [admin, user, guest]
 *           default: user
 *     UpdateUserRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role:
 *           type: string
 *           enum: [admin, user, guest]
 */

/**
 * @openapi
 * /users:
 *   get:
 *     tags:
 *       - 2. Users
 *     summary: Get all users
 *     description: Returns a list of all users
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, user, guest]
 *         description: Filter by role
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 */
router.get('/', (req: Request, res: Response) => {
  let result = Array.from(users.values());
  
  const { role } = req.query;
  
  if (role) {
    result = result.filter(u => u.role === role);
  }
  
  res.json({
    data: result,
    total: result.length,
  });
});

/**
 * @openapi
 * /users/html:
 *   get:
 *     tags:
 *       - 2. Users
 *     summary: Get all users as HTML
 *     description: Returns an HTML page displaying all users
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, user, guest]
 *         description: Filter by role
 *     responses:
 *       200:
 *         description: HTML page with users list
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
router.get('/html', (req: Request, res: Response) => {
  let result = Array.from(users.values());
  
  const { role } = req.query;
  
  if (role) {
    result = result.filter(u => u.role === role);
  }

  const escapeHtml = (text: string): string => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, char => map[char]);
  };

  let cards = '';
  if (result.length === 0) {
    cards = `<div class="empty">No users found</div>`;
  } else {
    for (const user of result) {
      cards += `
        <div class="card">
          <div class="card-title">${escapeHtml(user.name)}</div>
          <p class="email">${escapeHtml(user.email)}</p>
          <div class="card-meta">
            <span class="badge badge-${user.role}">${user.role}</span>
            <span class="timestamp">Joined: ${new Date(user.createdAt).toLocaleDateString()}</span>
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
  <title>Users - Sample API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #e4e4e7; min-height: 100vh; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 1.5rem; color: #f4f4f5; border-bottom: 2px solid #8b5cf6; padding-bottom: 0.5rem; }
    .card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; transition: transform 0.2s, box-shadow 0.2s; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); }
    .card-title { font-size: 1.25rem; font-weight: 600; color: #f4f4f5; margin-bottom: 0.5rem; }
    .card-meta { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; text-transform: uppercase; }
    .badge-admin { background: #8b5cf6; color: #fff; }
    .badge-user { background: #3b82f6; color: #fff; }
    .badge-guest { background: #6b7280; color: #fff; }
    .email { color: #60a5fa; font-size: 0.9rem; }
    .timestamp { color: #71717a; font-size: 0.8rem; }
    .empty { text-align: center; padding: 3rem; color: #71717a; }
    .count { color: #71717a; font-size: 0.9rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Users</h1>
    <p class="count">${result.length} user${result.length !== 1 ? 's' : ''} found</p>
    ${cards}
  </div>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags:
 *       - 2. Users
 *     summary: Get user by ID
 *     description: Returns a single user by their ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.get('/:id', (req: Request, res: Response) => {
  const user = users.get(req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
});

/**
 * @openapi
 * /users:
 *   post:
 *     tags:
 *       - 2. Users
 *     summary: Create a new user
 *     description: Creates a new user with the provided data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid request body
 */
router.post('/', (req: Request, res: Response) => {
  const { name, email, role = 'user' } = req.body;
  
  console.log('Creating user:', req.body);
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  // Check for duplicate email
  const existingUser = Array.from(users.values()).find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({ error: 'Email already exists' });
  }
  
  const user: User = {
    id: uuidv4(),
    name,
    email,
    role,
    createdAt: new Date().toISOString(),
  };
  
  users.set(user.id, user);
  res.status(201).json(user);
});

/**
 * @openapi
 * /users/{id}:
 *   put:
 *     tags:
 *       - 2. Users
 *     summary: Update a user
 *     description: Updates an existing user with the provided data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.put('/:id', (req: Request, res: Response) => {
  const user = users.get(req.params.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const { name, email, role } = req.body;
  
  // Check for duplicate email if changing
  if (email && email !== user.email) {
    const existingUser = Array.from(users.values()).find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
  }
  
  const updatedUser: User = {
    ...user,
    name: name ?? user.name,
    email: email ?? user.email,
    role: role ?? user.role,
  };
  
  users.set(user.id, updatedUser);
  res.json(updatedUser);
});

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags:
 *       - 2. Users
 *     summary: Delete a user
 *     description: Deletes a user by their ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       204:
 *         description: User deleted successfully
 *       404:
 *         description: User not found
 */
router.delete('/:id', (req: Request, res: Response) => {
  if (!users.has(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  users.delete(req.params.id);
  res.status(204).send();
});

export default router;

