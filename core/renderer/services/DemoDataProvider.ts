/**
 * Demo Data Provider
 * 
 * Provides mock data and state initialization for landing page interactive demos.
 * Each demo mode has its own set of pre-configured data to showcase specific features.
 */

import { Collection, Request, Folder, Environment, KeyValuePair } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export type DemoMode = 
  | 'request-editor'
  | 'variables'
  | 'git'
  | 'publishing'
  | 'mocking'
  | null;

// Helper to create a request
const createRequest = (
  name: string,
  method: string,
  url: string,
  options: Partial<Request> = {}
): Request => ({
  id: uuidv4(),
  name,
  method: method as Request['method'],
  url,
  headers: [],
  queryParams: [],
  pathParams: [],
  body: { type: 'none', content: '' },
  auth: { type: 'inherit' },
  scripts: { pre: '', post: '' },
  ...options,
});

// Helper to create a folder
const createFolder = (
  name: string,
  requests: Request[] = [],
  folders: Folder[] = []
): Folder => ({
  id: uuidv4(),
  name,
  requests,
  folders,
});

// Helper to create a variable
const createVariable = (
  key: string,
  value: string,
  enabled: boolean = true
): KeyValuePair => ({
  id: uuidv4(),
  key,
  value,
  enabled,
});

// ============================================================================
// Demo Collections
// ============================================================================

// Stable IDs for demo requests (so we can reference them by ID)
export const DEMO_REQUEST_IDS = {
  GET_ALL_TASKS: 'demo-req-get-all-tasks',
  GET_ALL_TASKS_HTML: 'demo-req-get-all-tasks-html',
  GET_ALL_USERS: 'demo-req-get-all-users',
  CREATE_USER: 'demo-req-create-user',
  HEALTH_CHECK: 'demo-req-health-check',
};

/**
 * Request Editor Demo Collection
 * Showcases content type previews, JSON-Path filtering, schema validation
 */
export const getRequestEditorDemoCollection = (): Collection => {
  const usersRequests = [
    {
      ...createRequest('Get All Users', 'GET', '{{baseUrl}}/users', {
        description: 'Retrieve a list of all users with pagination support.',
        headers: [
          { id: uuidv4(), key: 'Accept', value: 'application/json', enabled: true },
        ],
      }),
      id: DEMO_REQUEST_IDS.GET_ALL_USERS,
    },
    createRequest('Get User by ID', 'GET', '{{baseUrl}}/users/{{userId}}', {
      description: 'Retrieve a specific user by their unique identifier.',
    }),
    {
      ...createRequest('Create User', 'POST', '{{baseUrl}}/users', {
        description: 'Create a new user account.',
        headers: [
          { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
        ],
        body: {
          type: 'json',
          content: JSON.stringify({
            name: 'John Doe',
            email: 'john@example.com',
            role: 'user',
          }, null, 2),
        },
      }),
      id: DEMO_REQUEST_IDS.CREATE_USER,
    },
  ];

  const tasksRequests = [
    {
      ...createRequest('Get All Tasks', 'GET', '{{baseUrl}}/tasks', {
        description: 'Get a list of all tasks as JSON.',
        headers: [
          { id: uuidv4(), key: 'Accept', value: 'application/json', enabled: true },
        ],
      }),
      id: DEMO_REQUEST_IDS.GET_ALL_TASKS,
    },
    {
      ...createRequest('Get All Tasks as HTML', 'GET', '{{baseUrl}}/tasks/html', {
        description: 'Get a list of all tasks rendered as HTML.',
        headers: [
          { id: uuidv4(), key: 'Accept', value: 'text/html', enabled: true },
        ],
      }),
      id: DEMO_REQUEST_IDS.GET_ALL_TASKS_HTML,
    },
    createRequest('Create Task', 'POST', '{{baseUrl}}/tasks', {
      headers: [
        { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
      ],
      body: {
        type: 'json',
        content: JSON.stringify({
          title: 'New Task',
          description: 'Task description',
          status: 'pending',
          priority: 'medium',
        }, null, 2),
      },
    }),
  ];

  return {
    id: 'demo-request-editor',
    name: 'Sample API',
    requests: [
      {
        ...createRequest('Health Check', 'GET', '{{baseUrl}}/health', {
          description: 'Check API health status.',
        }),
        id: DEMO_REQUEST_IDS.HEALTH_CHECK,
      },
    ],
    folders: [
      createFolder('Users', usersRequests),
      createFolder('Tasks', tasksRequests),
    ],
    variables: [
      createVariable('baseUrl', 'https://sample-api.echolon.app'),
      createVariable('userId', '1'),
    ],
    specSource: {
      type: 'url',
      format: 'openapi',
      url: 'https://sample-api.echolon.app/openapi.json',
      lastSyncedAt: Date.now(),
      syncFrequencyMins: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

/**
 * Variables Demo Collection
 * Showcases variable tooltips, scopes, and dynamic functions
 */
export const getVariablesDemoCollection = (): Collection => ({
  id: 'demo-variables',
  name: 'Variables Demo',
  requests: [
    createRequest('Test Variables', 'POST', '{{baseUrl}}/echo', {
      description: 'Test request showing variable interpolation. Hover over variables to see their values!',
      headers: [
        { id: uuidv4(), key: 'Authorization', value: 'Bearer {{apiToken}}', enabled: true },
        { id: uuidv4(), key: 'X-Request-ID', value: '{{$uuid}}', enabled: true },
        { id: uuidv4(), key: 'X-Timestamp', value: '{{$timestamp}}', enabled: true },
        { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
      ],
      queryParams: [
        { id: uuidv4(), key: 'userId', value: '{{userId}}', enabled: true },
        { id: uuidv4(), key: 'random', value: '{{$randomInt(1, 100)}}', enabled: true },
      ],
      body: {
        type: 'json',
        content: JSON.stringify({
          name: '{{userName}}',
          email: '{{userEmail}}',
          timestamp: '{{$isoTimestamp}}',
          uuid: '{{$uuid}}',
          randomNumber: '{{$randomInt(1, 1000)}}',
        }, null, 2),
      },
    }),
    createRequest('Environment Test', 'GET', '{{baseUrl}}/health', {
      description: 'Shows environment-based configuration. Variables change based on selected environment.',
    }),
  ],
  folders: [],
  variables: [
    createVariable('baseUrl', 'https://sample-api.echolon.app'),
    createVariable('apiToken', 'demo-token-12345'),
    createVariable('userId', '42'),
    createVariable('userName', 'Demo User'),
    createVariable('userEmail', 'demo@echolon.app'),
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/**
 * Git Demo Collection
 * Showcases Git integration with staged changes
 */
export const getGitDemoCollection = (): Collection => {
  const authRequests = [
    createRequest('Login', 'POST', '{{baseUrl}}/auth/login', {
      body: {
        type: 'json',
        content: JSON.stringify({
          email: '{{email}}',
          password: '{{password}}',
        }, null, 2),
      },
    }),
    createRequest('Refresh Token', 'POST', '{{baseUrl}}/auth/refresh'),
  ];

  const userRequests = [
    createRequest('Get Users', 'GET', '{{baseUrl}}/users'),
    createRequest('Create User', 'POST', '{{baseUrl}}/users'),
  ];

  return {
    id: 'demo-git',
    name: 'API Collection',
    requests: [],
    folders: [
      createFolder('Authentication', authRequests),
      createFolder('Users', userRequests),
    ],
    variables: [
      createVariable('baseUrl', 'https://api.example.com'),
      createVariable('email', 'user@example.com'),
      createVariable('password', '********'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

/**
 * Publishing Demo Collection
 * Showcases API documentation publishing workflow
 */
export const getPublishingDemoCollection = (): Collection => {
  const productRequests = [
    createRequest('List Products', 'GET', '{{baseUrl}}/products', {
      description: 'Get all products with optional filtering.',
    }),
    createRequest('Get Product', 'GET', '{{baseUrl}}/products/{{productId}}', {
      description: 'Get a specific product by ID.',
    }),
    createRequest('Create Product', 'POST', '{{baseUrl}}/products', {
      description: 'Create a new product.',
      body: {
        type: 'json',
        content: JSON.stringify({
          name: 'New Product',
          price: 29.99,
          category: 'electronics',
        }, null, 2),
      },
    }),
  ];

  const orderRequests = [
    createRequest('List Orders', 'GET', '{{baseUrl}}/orders'),
    createRequest('Create Order', 'POST', '{{baseUrl}}/orders'),
  ];

  return {
    id: 'demo-publishing',
    name: 'My Public API',
    requests: [],
    folders: [
      createFolder('Products', productRequests),
      createFolder('Orders', orderRequests),
    ],
    variables: [
      createVariable('baseUrl', 'https://api.mystore.com'),
      createVariable('productId', '123'),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

/**
 * Mocking Demo Collection
 * Showcases mock server functionality
 */
export const getMockingDemoCollection = (): Collection => ({
  id: 'demo-mocking',
  name: 'Mock Server Demo',
  requests: [
    createRequest('Get Users (Mocked)', 'GET', '{{mockUrl}}/api/users', {
      description: 'This request will hit the local mock server.',
      mockResponse: {
        enabled: true,
        statusCode: 200,
        delay: 100,
        headers: [
          { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
        ],
        body: JSON.stringify([
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Charlie', email: 'charlie@example.com' },
        ], null, 2),
      },
    }),
    createRequest('Create User (Mocked)', 'POST', '{{mockUrl}}/api/users', {
      description: 'Mock response for user creation.',
      body: {
        type: 'json',
        content: JSON.stringify({
          name: 'New User',
          email: 'newuser@example.com',
        }, null, 2),
      },
      mockResponse: {
        enabled: true,
        statusCode: 201,
        delay: 200,
        headers: [
          { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
        ],
        body: JSON.stringify({
          id: 4,
          name: 'New User',
          email: 'newuser@example.com',
          createdAt: new Date().toISOString(),
        }, null, 2),
      },
    }),
    createRequest('Error Response (Mocked)', 'GET', '{{mockUrl}}/api/error', {
      description: 'Demonstrates error response mocking.',
      mockResponse: {
        enabled: true,
        statusCode: 500,
        delay: 50,
        headers: [
          { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true },
        ],
        body: JSON.stringify({
          error: 'Internal Server Error',
          message: 'Something went wrong',
        }, null, 2),
      },
    }),
  ],
  folders: [],
  variables: [
    createVariable('mockUrl', 'http://localhost:3001'),
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ============================================================================
// Demo Environments
// ============================================================================

export const getDemoEnvironments = (demoMode: DemoMode): Environment[] => {
  const baseEnvs: Environment[] = [
    {
      id: 'env-production',
      name: 'Production',
      variables: [
        createVariable('baseUrl', 'https://sample-api.echolon.app'),
        createVariable('apiToken', 'prod-token-xxxxx'),
      ],
      isActive: false,
    },
    {
      id: 'env-staging',
      name: 'Staging',
      variables: [
        createVariable('baseUrl', 'https://staging-api.echolon.app'),
        createVariable('apiToken', 'staging-token-xxxxx'),
      ],
      isActive: false,
    },
    {
      id: 'env-local',
      name: 'Local Development',
      variables: [
        createVariable('baseUrl', 'http://localhost:3501'),
        createVariable('apiToken', 'dev-token-12345'),
      ],
      isActive: true,
    },
  ];

  return baseEnvs;
};

// ============================================================================
// Get Demo Data by Mode
// ============================================================================

export interface DemoData {
  collection: Collection;
  environments: Environment[];
  selectedEnvironmentId: string | null;
  selectedRequestId: string | null;
  openPanels?: string[];
}

// Helper to find first request in collection (searches folders too)
const findFirstRequest = (collection: Collection): Request | null => {
  // Check root requests first
  if (collection.requests && collection.requests.length > 0) {
    return collection.requests[0];
  }
  // Check folders
  if (collection.folders) {
    for (const folder of collection.folders) {
      if (folder.requests && folder.requests.length > 0) {
        return folder.requests[0];
      }
    }
  }
  return null;
};

export const getDemoData = (demoMode: DemoMode): DemoData | null => {
  if (!demoMode) return null;

  const environments = getDemoEnvironments(demoMode);

  switch (demoMode) {
    case 'request-editor': {
      const collection = getRequestEditorDemoCollection();
      const firstRequest = findFirstRequest(collection);
      return {
        collection,
        environments,
        selectedEnvironmentId: 'env-production',
        selectedRequestId: firstRequest?.id || null,
        openPanels: ['response', 'schema'],
      };
    }

    case 'variables': {
      const collection = getVariablesDemoCollection();
      const firstRequest = findFirstRequest(collection);
      return {
        collection,
        environments,
        selectedEnvironmentId: 'env-production',
        selectedRequestId: firstRequest?.id || null,
        openPanels: ['variables'],
      };
    }

    case 'git': {
      const collection = getGitDemoCollection();
      return {
        collection,
        environments,
        selectedEnvironmentId: null,
        selectedRequestId: null,
        openPanels: ['git'],
      };
    }

    case 'publishing': {
      const collection = getPublishingDemoCollection();
      return {
        collection,
        environments,
        selectedEnvironmentId: null,
        selectedRequestId: null,
        openPanels: ['sharing'],
      };
    }

    case 'mocking': {
      const collection = getMockingDemoCollection();
      const firstRequest = findFirstRequest(collection);
      return {
        collection,
        environments: [],
        selectedEnvironmentId: null,
        selectedRequestId: firstRequest?.id || null,
        openPanels: ['mocking'],
      };
    }

    default:
      return null;
  }
};

export default {
  getDemoData,
  getDemoEnvironments,
  getRequestEditorDemoCollection,
  getVariablesDemoCollection,
  getGitDemoCollection,
  getPublishingDemoCollection,
  getMockingDemoCollection,
};
