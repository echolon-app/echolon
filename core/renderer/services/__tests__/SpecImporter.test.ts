import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SpecImporter, PostmanAdapter, OpenAPIAdapter } from '../SpecImporter';

// Test file paths
const TEST_FILES_DIR = join(__dirname, '../../../tests');
const ASANA_COLLECTION_PATH = join(TEST_FILES_DIR, 'Asana.postman_collection.json');
const GITHUB_COLLECTION_PATH = join(TEST_FILES_DIR, 'GitHub v3 REST API.postman_collection.json');

describe('SpecImporter', () => {
  let specImporter: SpecImporter;
  let asanaContent: string;
  let githubContent: string;

  beforeAll(() => {
    specImporter = SpecImporter.getInstance();
    asanaContent = readFileSync(ASANA_COLLECTION_PATH, 'utf-8');
    githubContent = readFileSync(GITHUB_COLLECTION_PATH, 'utf-8');
  });

  describe('Format Detection', () => {
    it('should detect Asana collection as Postman format', () => {
      const format = specImporter.detectFormat(asanaContent);
      expect(format).toBe('postman');
    });

    it('should detect GitHub collection as Postman format', () => {
      const format = specImporter.detectFormat(githubContent);
      expect(format).toBe('postman');
    });
  });

  describe('Spec Info Extraction', () => {
    it('should extract info from Asana collection', () => {
      const info = specImporter.getSpecInfo(asanaContent);
      expect(info).not.toBeNull();
      expect(info?.name).toBe('Asana');
      expect(info?.format).toBe('postman');
    });

    it('should extract info from GitHub collection', () => {
      const info = specImporter.getSpecInfo(githubContent);
      expect(info).not.toBeNull();
      expect(info?.name).toBe('GitHub v3 REST API');
      expect(info?.format).toBe('postman');
    });
  });
});

describe('PostmanAdapter', () => {
  let adapter: PostmanAdapter;
  let asanaContent: string;
  let githubContent: string;

  beforeAll(() => {
    adapter = new PostmanAdapter();
    asanaContent = readFileSync(ASANA_COLLECTION_PATH, 'utf-8');
    githubContent = readFileSync(GITHUB_COLLECTION_PATH, 'utf-8');
  });

  describe('canParse', () => {
    it('should recognize Asana collection as Postman format', () => {
      expect(adapter.canParse(asanaContent)).toBe(true);
    });

    it('should recognize GitHub collection as Postman format', () => {
      expect(adapter.canParse(githubContent)).toBe(true);
    });

    it('should reject invalid JSON', () => {
      expect(adapter.canParse('not json')).toBe(false);
    });

    it('should reject JSON without Postman structure', () => {
      expect(adapter.canParse('{"foo": "bar"}')).toBe(false);
    });
  });

  describe('Asana Collection Import', () => {
    let result: ReturnType<typeof adapter.parse>;

    beforeAll(() => {
      result = adapter.parse(asanaContent);
    });

    it('should create a collection with correct name', () => {
      expect(result.collection.name).toBe('Asana');
    });

    it('should have description', () => {
      expect(result.collection.description).toContain('Asana API');
    });

    it('should create folders for each category', () => {
      expect(result.collection.folders.length).toBeGreaterThan(0);
      
      // Check for some expected folders
      const folderNames = result.collection.folders.map(f => f.name);
      expect(folderNames).toContain('Allocations');
    });

    it('should parse requests correctly', () => {
      // Find the Allocations folder
      const allocationsFolder = result.collection.folders.find(f => f.name === 'Allocations');
      expect(allocationsFolder).toBeDefined();
      
      // Check first request
      const firstRequest = allocationsFolder?.requests[0];
      expect(firstRequest).toBeDefined();
      expect(firstRequest?.name).toBe('Get an allocation');
      expect(firstRequest?.method).toBe('GET');
      expect(firstRequest?.url).toContain('{{baseUrl}}');
      expect(firstRequest?.url).toContain('/allocations/');
    });

    it('should parse path variables correctly', () => {
      const allocationsFolder = result.collection.folders.find(f => f.name === 'Allocations');
      const getRequest = allocationsFolder?.requests.find(r => r.name === 'Get an allocation');
      
      expect(getRequest?.pathParams).toBeDefined();
      expect(getRequest?.pathParams?.length).toBeGreaterThan(0);
      
      const allocationGidParam = getRequest?.pathParams?.find(p => p.key === 'allocation_gid');
      expect(allocationGidParam).toBeDefined();
      expect(allocationGidParam?.value).toBe('77688');
      expect(allocationGidParam?.description).toContain('Globally unique identifier');
    });

    it('should parse query parameters correctly', () => {
      const allocationsFolder = result.collection.folders.find(f => f.name === 'Allocations');
      const getRequest = allocationsFolder?.requests.find(r => r.name === 'Get an allocation');
      
      expect(getRequest?.queryParams).toBeDefined();
      
      // Check for opt_pretty param
      const optPrettyParam = getRequest?.queryParams?.find(p => p.key === 'opt_pretty');
      expect(optPrettyParam).toBeDefined();
      expect(optPrettyParam?.enabled).toBe(false); // disabled in collection
    });

    it('should correctly parse URL without query params when extracted separately', () => {
      const allocationsFolder = result.collection.folders.find(f => f.name === 'Allocations');
      const getRequest = allocationsFolder?.requests.find(r => r.name === 'Get an allocation');
      
      // URL should not contain ? since params are extracted
      expect(getRequest?.url).not.toContain('?');
    });
  });

  describe('GitHub Collection Import', () => {
    let result: ReturnType<typeof adapter.parse>;

    beforeAll(() => {
      result = adapter.parse(githubContent);
    });

    it('should create a collection with correct name', () => {
      expect(result.collection.name).toBe('GitHub v3 REST API');
    });

    it('should create folders structure', () => {
      expect(result.collection.folders.length).toBeGreaterThan(0);
    });

    it('should parse headers correctly', () => {
      // Find a request with headers
      const rootFolder = result.collection.folders.find(f => f.name === '/');
      const apiRootRequest = rootFolder?.requests.find(r => r.name === 'GitHub API Root');
      
      expect(apiRootRequest?.headers).toBeDefined();
      expect(apiRootRequest?.headers?.length).toBeGreaterThan(0);
      
      const acceptHeader = apiRootRequest?.headers?.find(h => h.key === 'Accept');
      expect(acceptHeader?.value).toBe('application/json');
    });

    it('should parse path variables from URL pattern', () => {
      // Find a request with path variables like :ghsa_id
      const advisoriesFolder = result.collection.folders.find(f => f.name === 'advisories');
      const ghsaFolder = advisoriesFolder?.folders?.find(f => f.name === '{ghsa_id}');
      const getAdvisoryRequest = ghsaFolder?.requests?.find(r => r.name === 'Get a global security advisory');
      
      expect(getAdvisoryRequest?.pathParams).toBeDefined();
      const ghsaIdParam = getAdvisoryRequest?.pathParams?.find(p => p.key === 'ghsa_id');
      expect(ghsaIdParam).toBeDefined();
    });

    it('should preserve variable syntax in URLs', () => {
      const rootFolder = result.collection.folders.find(f => f.name === '/');
      const apiRootRequest = rootFolder?.requests.find(r => r.name === 'GitHub API Root');
      
      expect(apiRootRequest?.url).toContain('{{baseUrl}}');
    });
  });

  describe('URL Parsing', () => {
    it('should handle raw URL strings', () => {
      const simpleCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Simple Request',
            request: {
              method: 'GET',
              url: 'https://api.example.com/users',
            },
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(simpleCollection));
      expect(result.collection.requests[0].url).toBe('https://api.example.com/users');
    });

    it('should handle complex URL objects with host array', () => {
      const complexUrlCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Complex URL Request',
            request: {
              method: 'GET',
              url: {
                raw: '{{baseUrl}}/api/v1/users/:userId',
                protocol: 'https',
                host: ['{{baseUrl}}'],
                path: ['api', 'v1', 'users', ':userId'],
                variable: [
                  {
                    key: 'userId',
                    value: '123',
                    description: 'User ID',
                  },
                ],
                query: [
                  {
                    key: 'include',
                    value: 'profile',
                    disabled: false,
                  },
                ],
              },
            },
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(complexUrlCollection));
      const request = result.collection.requests[0];
      
      // URL should not have query params (extracted separately)
      expect(request.url).not.toContain('?');
      
      // Path params should be extracted
      expect(request.pathParams).toBeDefined();
      const userIdParam = request.pathParams?.find(p => p.key === 'userId');
      expect(userIdParam).toBeDefined();
      expect(userIdParam?.value).toBe('123');
      expect(userIdParam?.description).toBe('User ID');
      
      // Query params should be extracted
      expect(request.queryParams).toBeDefined();
      const includeParam = request.queryParams?.find(p => p.key === 'include');
      expect(includeParam).toBeDefined();
      expect(includeParam?.value).toBe('profile');
    });
  });

  describe('Authentication Parsing', () => {
    it('should parse bearer auth correctly', () => {
      const authCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Auth Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
        auth: {
          type: 'bearer',
          bearer: [
            { key: 'token', value: 'test-token-123' },
          ],
        },
      };
      
      const result = adapter.parse(JSON.stringify(authCollection));
      expect(result.collection.auth?.type).toBe('bearer');
    });

    it('should parse bearer auth with object format', () => {
      const authCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Auth Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
        auth: {
          type: 'bearer',
          bearer: {
            token: 'test-token-456',
          },
        },
      };
      
      const result = adapter.parse(JSON.stringify(authCollection));
      expect(result.collection.auth?.type).toBe('bearer');
    });

    it('should parse basic auth correctly', () => {
      const authCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Auth Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
        auth: {
          type: 'basic',
          basic: [
            { key: 'username', value: 'testuser' },
            { key: 'password', value: 'testpass' },
          ],
        },
      };
      
      const result = adapter.parse(JSON.stringify(authCollection));
      expect(result.collection.auth?.type).toBe('basic');
    });

    it('should parse api-key auth correctly', () => {
      const authCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Auth Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
        auth: {
          type: 'apikey',
          apikey: [
            { key: 'key', value: 'X-API-Key' },
            { key: 'value', value: 'my-secret-key' },
          ],
        },
      };
      
      const result = adapter.parse(JSON.stringify(authCollection));
      expect(result.collection.auth?.type).toBe('api-key');
    });
  });

  describe('Body Parsing', () => {
    it('should parse raw JSON body', () => {
      const bodyCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Body Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'POST Request',
            request: {
              method: 'POST',
              url: 'https://api.example.com/users',
              body: {
                mode: 'raw',
                raw: '{"name": "John", "email": "john@example.com"}',
                options: {
                  raw: {
                    language: 'json',
                  },
                },
              },
            },
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(bodyCollection));
      const request = result.collection.requests[0];
      
      expect(request.body.type).toBe('json');
      expect(request.body.content).toContain('"name": "John"');
    });

    it('should parse urlencoded body', () => {
      const bodyCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Body Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'POST Request',
            request: {
              method: 'POST',
              url: 'https://api.example.com/users',
              body: {
                mode: 'urlencoded',
                urlencoded: [
                  { key: 'username', value: 'john' },
                  { key: 'password', value: 'secret' },
                ],
              },
            },
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(bodyCollection));
      const request = result.collection.requests[0];
      
      expect(request.body.type).toBe('x-www-form-urlencoded');
      expect(request.body.content).toContain('username=john');
      expect(request.body.content).toContain('password=secret');
    });
  });

  describe('Scripts Parsing', () => {
    it('should parse pre-request scripts', () => {
      const scriptCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Script Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Request with Scripts',
            request: {
              method: 'GET',
              url: 'https://api.example.com/test',
            },
            event: [
              {
                listen: 'prerequest',
                script: {
                  exec: ['console.log("Pre-request");', 'pm.environment.set("foo", "bar");'],
                },
              },
              {
                listen: 'test',
                script: {
                  exec: 'pm.test("Status is 200", function () { pm.response.to.have.status(200); });',
                },
              },
            ],
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(scriptCollection));
      const request = result.collection.requests[0];
      
      expect(request.scripts.pre).toContain('console.log("Pre-request")');
      expect(request.scripts.pre).toContain('pm.environment.set');
      expect(request.scripts.post).toContain('pm.test');
    });
  });

  describe('Collection Variables', () => {
    it('should parse collection variables', () => {
      const varCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Variable Test Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
        variable: [
          { key: 'baseUrl', value: 'https://api.example.com' },
          { key: 'apiKey', value: 'secret-key', disabled: true },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(varCollection));
      
      expect(result.collection.variables).toBeDefined();
      expect(result.collection.variables?.length).toBe(2);
      
      const baseUrlVar = result.collection.variables?.find(v => v.key === 'baseUrl');
      expect(baseUrlVar?.value).toBe('https://api.example.com');
      expect(baseUrlVar?.enabled).toBe(true);
      
      const apiKeyVar = result.collection.variables?.find(v => v.key === 'apiKey');
      expect(apiKeyVar?.enabled).toBe(false);
    });
  });

  describe('Nested Folders', () => {
    it('should handle nested folder structure', () => {
      const nestedCollection = {
        info: {
          _postman_id: 'test-id',
          name: 'Nested Folder Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Users',
            item: [
              {
                name: 'Admin',
                item: [
                  {
                    name: 'Get Admin Users',
                    request: {
                      method: 'GET',
                      url: 'https://api.example.com/users/admin',
                    },
                  },
                ],
              },
              {
                name: 'Get All Users',
                request: {
                  method: 'GET',
                  url: 'https://api.example.com/users',
                },
              },
            ],
          },
        ],
      };
      
      const result = adapter.parse(JSON.stringify(nestedCollection));
      
      // Check top-level folder
      expect(result.collection.folders.length).toBe(1);
      const usersFolder = result.collection.folders[0];
      expect(usersFolder.name).toBe('Users');
      
      // Check nested folder
      expect(usersFolder.folders?.length).toBe(1);
      const adminFolder = usersFolder.folders?.[0];
      expect(adminFolder?.name).toBe('Admin');
      
      // Check request in nested folder
      expect(adminFolder?.requests?.length).toBe(1);
      expect(adminFolder?.requests?.[0].name).toBe('Get Admin Users');
      
      // Check request at parent level
      expect(usersFolder.requests?.length).toBe(1);
      expect(usersFolder.requests?.[0].name).toBe('Get All Users');
    });
  });
});

describe('OpenAPIAdapter', () => {
  let adapter: OpenAPIAdapter;

  beforeAll(() => {
    adapter = new OpenAPIAdapter();
  });

  it('should not recognize Postman collections', () => {
    const asanaContent = readFileSync(ASANA_COLLECTION_PATH, 'utf-8');
    expect(adapter.canParse(asanaContent)).toBe(false);
  });

  it('should recognize OpenAPI 3.0 spec', () => {
    const openAPISpec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    });
    expect(adapter.canParse(openAPISpec)).toBe(true);
  });

  it('should recognize Swagger 2.0 spec', () => {
    const swaggerSpec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    });
    expect(adapter.canParse(swaggerSpec)).toBe(true);
  });
});

