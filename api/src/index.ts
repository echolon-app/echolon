import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { WSManager } from './wsManager';
import { ProxyHandler } from './proxyHandler';
import { mockStore } from './mockStore';
import { ServerConfig, StoredMock, RESERVED_NAMESPACES, MIN_NAMESPACE_LENGTH } from './types';
import { initDatabase, closeDatabase, dbConnected } from './config/database';
import { apiLimiter } from './middleware/rateLimit';
import { passport } from './services/oauth';
import packageJson from '../package.json';

// Import routes
import authRoutes from './routes/auth';
import subscriptionRoutes from './routes/subscriptions';
import teamRoutes from './routes/teams';
import webhookRoutes from './routes/webhooks';
import publicSpecsRoutes from './routes/publicSpecs';

// Configuration from environment or defaults
const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3500', 10),
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  pingInterval: parseInt(process.env.PING_INTERVAL || '30000', 10),
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
};

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const wsManager = new WSManager(wss, config);
const proxyHandler = new ProxyHandler(wsManager);

// ============== Middleware ==============

app.use(cors({
  origin: config.allowedOrigins || '*',
  credentials: true,
}));

// Stripe webhooks need raw body - must be before express.json()
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Standard body parsing for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Passport
app.use(passport.initialize());

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// ============== API Routes ==============

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/public-specs', publicSpecsRoutes);

// ============== Internal API Routes ==============
// All internal routes prefixed with /_internal to avoid conflicts with user mocks

// Health check endpoint
app.get('/_internal/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    connectedClients: wsManager.getConnectedNamespaces(),
  });
});

// Version endpoint
app.get('/_internal/version', (req: Request, res: Response) => {
  res.json({
    version: packageJson.version,
    name: 'echolon-api',
  });
});

// List connected namespaces (for debugging/admin)
app.get('/_internal/namespaces', (req: Request, res: Response) => {
  const namespaces = wsManager.getConnectedNamespaces();
  res.json({
    count: namespaces.length,
    namespaces: namespaces.map(ns => ({
      namespace: ns,
      url: `https://${ns}.echolon.app`,
    })),
  });
});

// Check if a namespace is available
app.get('/_internal/check/:namespace', (req: Request, res: Response) => {
  const { namespace } = req.params;
  
  // Check if reserved
  const isReserved = RESERVED_NAMESPACES.includes(namespace as any);
  if (isReserved) {
    return res.json({
      namespace,
      available: false,
      connected: false,
      reason: 'reserved',
      message: `Namespace "${namespace}" is reserved and cannot be used.`,
    });
  }
  
  // Check minimum length
  if (namespace.length < MIN_NAMESPACE_LENGTH) {
    return res.json({
      namespace,
      available: false,
      connected: false,
      reason: 'too_short',
      message: `Namespace must be at least ${MIN_NAMESPACE_LENGTH} characters long.`,
    });
  }
  
  // Check if valid format
  if (!/^[a-z0-9-]+$/.test(namespace)) {
    return res.json({
      namespace,
      available: false,
      connected: false,
      reason: 'invalid_format',
      message: 'Namespace must contain only lowercase letters, numbers, and hyphens.',
    });
  }
  
  // Check if already connected
  const isConnected = wsManager.isNamespaceConnected(namespace);
  res.json({
    namespace,
    available: !isConnected,
    connected: isConnected,
  });
});

// ============== Public Specs API ==============

// Reserved subdomains for public specs
const RESERVED_PUBLIC_SUBDOMAINS = [
  'www', 'api', 'app', 'web', 'admin', 'dashboard', 'docs', 'help',
  'support', 'status', 'blog', 'mail', 'email', 'cdn', 'static',
  'assets', 'img', 'images', 'css', 'js', 'fonts', 'media',
  'echolon', 'echo', 'spec', 'specs', 'public', 'private',
];

const PUBLIC_SPECS_BUCKET = 'echolon-public-specs';
const PUBLIC_SPECS_REGION = 'us-east-1';

// Check if a public spec subdomain is available
app.get('/_internal/check-public-spec/:subdomain', async (req: Request, res: Response) => {
  const { subdomain } = req.params;
  
  // Check if reserved
  if (RESERVED_PUBLIC_SUBDOMAINS.includes(subdomain)) {
    return res.json({
      subdomain,
      available: false,
      reason: 'reserved',
      message: `Subdomain "${subdomain}" is reserved and cannot be used.`,
    });
  }
  
  // Check minimum length (3 characters)
  if (subdomain.length < 3) {
    return res.json({
      subdomain,
      available: false,
      reason: 'too_short',
      message: 'Subdomain must be at least 3 characters long.',
    });
  }
  
  // Check maximum length (63 characters - DNS limit)
  if (subdomain.length > 63) {
    return res.json({
      subdomain,
      available: false,
      reason: 'too_long',
      message: 'Subdomain must be at most 63 characters long.',
    });
  }
  
  // Check if valid format (lowercase alphanumeric and hyphens)
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && !/^[a-z0-9]$/.test(subdomain)) {
    return res.json({
      subdomain,
      available: false,
      reason: 'invalid_format',
      message: 'Subdomain must contain only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.',
    });
  }
  
  // Check for consecutive hyphens
  if (subdomain.includes('--')) {
    return res.json({
      subdomain,
      available: false,
      reason: 'invalid_format',
      message: 'Subdomain cannot contain consecutive hyphens.',
    });
  }
  
  try {
    // Check if manifest.json exists in S3 for this subdomain
    const s3Url = `https://${PUBLIC_SPECS_BUCKET}.s3.${PUBLIC_SPECS_REGION}.amazonaws.com/${subdomain}/manifest.json`;
    const response = await fetch(s3Url, { method: 'HEAD' });
    
    if (response.ok) {
      // Subdomain exists
      return res.json({
        subdomain,
        available: false,
        reason: 'exists',
        message: 'This subdomain is already taken.',
      });
    }
    
    // Subdomain is available
    return res.json({
      subdomain,
      available: true,
    });
  } catch (error) {
    // If there's an error checking S3, assume available (upload will fail if not)
    console.error('Error checking S3 for public spec subdomain:', error);
    return res.json({
      subdomain,
      available: true,
    });
  }
});

// Get manifest for a public spec subdomain
app.get('/_internal/public-spec/:subdomain/manifest', async (req: Request, res: Response) => {
  const { subdomain } = req.params;
  
  try {
    const s3Url = `https://${PUBLIC_SPECS_BUCKET}.s3.${PUBLIC_SPECS_REGION}.amazonaws.com/${subdomain}/manifest.json`;
    const response = await fetch(s3Url);
    
    if (!response.ok) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No public spec found for subdomain "${subdomain}"`,
      });
    }
    
    const manifest = await response.json();
    return res.json(manifest);
  } catch (error) {
    console.error('Error fetching manifest:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch manifest',
    });
  }
});

// ============== Mock Management API ==============

// Get all mocks for a namespace
app.get('/_internal/mocks/:namespace', (req: Request, res: Response) => {
  const { namespace } = req.params;
  const mocks = mockStore.getMocks(namespace);
  res.json({
    namespace,
    count: mocks.length,
    mocks,
  });
});

// Set all mocks for a namespace (replace all)
app.put('/_internal/mocks/:namespace', (req: Request, res: Response) => {
  const { namespace } = req.params;
  const { mocks } = req.body as { mocks: StoredMock[] };
  
  if (!Array.isArray(mocks)) {
    return res.status(400).json({ error: 'Invalid request', message: 'mocks must be an array' });
  }
  
  mockStore.setMocks(namespace, mocks);
  res.json({
    success: true,
    namespace,
    count: mocks.length,
  });
});

// Add or update a single mock
app.post('/_internal/mocks/:namespace', (req: Request, res: Response) => {
  const { namespace } = req.params;
  const mock = req.body as StoredMock;
  
  if (!mock.id || !mock.method || !mock.path) {
    return res.status(400).json({ 
      error: 'Invalid request', 
      message: 'Mock must have id, method, and path' 
    });
  }
  
  mockStore.upsertMock(namespace, mock);
  res.json({
    success: true,
    namespace,
    mock,
  });
});

// Delete a single mock
app.delete('/_internal/mocks/:namespace/:mockId', (req: Request, res: Response) => {
  const { namespace, mockId } = req.params;
  const deleted = mockStore.deleteMock(namespace, mockId);
  
  res.json({
    success: deleted,
    namespace,
    mockId,
  });
});

// Clear all mocks for a namespace
app.delete('/_internal/mocks/:namespace', (req: Request, res: Response) => {
  const { namespace } = req.params;
  mockStore.clearMocks(namespace);
  res.json({
    success: true,
    namespace,
  });
});

// ============== End Internal API Routes ==============

// Proxy handler for all other requests
// This catches requests coming to *.echolon.app subdomains
app.all('*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract namespace from host header
    const host = req.headers.host || '';
    const namespace = extractNamespace(host);

    if (!namespace) {
      // Not a subdomain request, return 404
      return res.status(404).json({
        error: 'Not Found',
        message: 'No namespace specified. Use <namespace>.echolon.app',
      });
    }

    // Forward request to connected client
    await proxyHandler.handleRequest(req, res, namespace);
  } catch (error) {
    next(error);
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
  });
});

// Extract namespace from host header
function extractNamespace(host: string): string | null {
  // Remove port if present
  const hostname = host.split(':')[0];

  // Check for localhost/dev patterns
  // e.g., test.localhost, test.127.0.0.1.nip.io
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1') || hostname.includes('.local')) {
    const parts = hostname.split('.');
    if (parts.length > 1 && parts[0] !== 'www') {
      return parts[0];
    }
    return null;
  }

  // Check for echolon.app subdomain
  // e.g., test.echolon.app -> test
  if (hostname.endsWith('.echolon.app')) {
    const subdomain = hostname.replace('.echolon.app', '');
    if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
      return subdomain;
    }
  }

  // Direct IP or root domain
  return null;
}

// Start server
const startServer = () => {
  // Start HTTP server immediately
  server.listen(config.port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Echolon API Server Started                   ║
╠═══════════════════════════════════════════════════════════╣
║  HTTP Server:  http://localhost:${config.port.toString().padEnd(24)}║
║  WebSocket:    ws://localhost:${config.port}/ws${' '.repeat(20)}║
║  API Docs:     http://localhost:${config.port}/api${' '.repeat(14)}║
║  Health:       http://localhost:${config.port}/_internal/health${' '.repeat(5)}║
╚═══════════════════════════════════════════════════════════╝
    `);
  });

  // Initialize database in the background (non-blocking)
  console.log('Initializing database in background...');
  initDatabase()
    .then(() => {
      console.log('✓ Database connected successfully');
    })
    .catch((error) => {
      console.error('✗ Database initialization failed:', error);
      // Don't exit - server can still handle routes that don't require DB
    });
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  wsManager.shutdown();
  await closeDatabase();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
startServer();

export { app, server, wsManager };
