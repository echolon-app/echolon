import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MockAPI, MockRoute, CapturedRequest, MockedResponse, HttpMethod, MockMode, CloudProxyStatus, CloudProxyRequest, CloudProxyResponse } from '@/types';
import { STORAGE_KEYS } from '../../shared/constants';
import { fileStorageManager } from '@/services/FileStorageManager';
import { useApp } from './AppContext';
import { useWorkspace } from './WorkspaceContext';
import { v4 as uuidv4 } from 'uuid';

const MOCK_APIS_FILE = 'mock-apis';

// Default values (can be overridden via settings)
const DEFAULT_MAX_CAPTURED_REQUESTS = 1000;
const DEFAULT_SAVE_DEBOUNCE_MS = 1000;

// Default cloud proxy server URL
const DEFAULT_CLOUD_SERVER_URL = 'https://proxy.echolon.app';

/**
 * Get or create userId from localStorage
 */
function getOrCreateUserId(): string {
  let userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
  if (!userId) {
    userId = uuidv4();
    localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
    console.log('[MockingContext] Created new userId:', userId);
  }
  return userId;
}

// Helper: Convert MockRoute to StoredMock format for cloud proxy
interface CloudStoredMock {
  id: string;
  method: string;
  path: string;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    delay?: number;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function routeToStoredMock(route: MockRoute): CloudStoredMock | null {
  if (!route.isMocked || !route.mockedResponse) return null;
  
  const headers: Record<string, string> = {};
  route.mockedResponse.headers.forEach(h => {
    headers[h.key] = h.value;
  });

  return {
    id: route.id,
    method: route.method,
    path: route.path,
    response: {
      status: route.mockedResponse.status,
      statusText: route.mockedResponse.statusText,
      headers,
      body: route.mockedResponse.body,
      delay: route.mockedResponse.delay,
    },
    enabled: route.isMocked,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function storedMockToRoute(mock: CloudStoredMock): MockRoute {
  const headers = Object.entries(mock.response.headers).map(([key, value]) => ({ key, value }));
  
  return {
    id: mock.id,
    method: mock.method,
    path: mock.path,
    isMocked: mock.enabled,
    mockedResponse: {
      status: mock.response.status,
      statusText: mock.response.statusText,
      headers,
      body: mock.response.body,
      delay: mock.response.delay,
    },
  };
}

interface MockingContextValue {
  // State
  mockApis: MockAPI[];
  activeMockApiId: string | null;
  capturedRequests: CapturedRequest[];
  selectedRequestId: string | null;
  localHostname: string;
  pendingCloudRequests: CloudProxyRequest[];
  
  // Mock API CRUD
  addMockApi: (name: string) => MockAPI;
  updateMockApi: (id: string, updates: Partial<MockAPI>) => void;
  deleteMockApi: (id: string) => void;
  setActiveMockApi: (id: string | null) => void;
  
  // Mock Server
  startMockServer: (mockApiId: string) => Promise<boolean>;
  stopMockServer: (mockApiId: string) => Promise<boolean>;
  
  // Cloud Proxy
  setMockMode: (mockApiId: string, mode: MockMode) => void;
  connectCloudProxy: (mockApiId: string) => Promise<{ success: boolean; error?: string }>;
  disconnectCloudProxy: (mockApiId: string) => Promise<void>;
  checkNamespaceAvailability: (namespace: string, serverUrl?: string) => Promise<{ available: boolean; connected: boolean }>;
  sendCloudProxyResponse: (response: CloudProxyResponse) => void;
  
  // Routes
  addRoute: (mockApiId: string, method: HttpMethod, path: string) => void;
  updateRoute: (mockApiId: string, routeId: string, updates: Partial<MockRoute>) => void;
  deleteRoute: (mockApiId: string, routeId: string) => void;
  setMockedResponse: (mockApiId: string, routeId: string, response: MockedResponse) => void;
  
  // Captured Requests
  selectRequest: (id: string | null) => void;
  clearCapturedRequests: (mockApiId?: string) => void;
  deleteCapturedRequest: (requestId: string) => void;
  mockFromCapturedRequest: (requestId: string, response: MockedResponse) => void;
  toggleRequestMock: (requestId: string, enabled: boolean) => void;
  updateCapturedRequestResponse: (requestId: string, response: Partial<MockedResponse>) => void;
}

const MockingContext = createContext<MockingContextValue | null>(null);

const DEFAULT_PORT = 3456;

export const MockingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useApp();
  const { activeWorkspace } = useWorkspace();
  
  // Get settings with defaults
  const maxCapturedRequests = settings.mockingMaxCapturedRequests ?? DEFAULT_MAX_CAPTURED_REQUESTS;
  const saveDebounceMs = settings.mockingSaveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
  
  const [mockApis, setMockApis] = useState<MockAPI[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRequestsLoaded, setIsRequestsLoaded] = useState(false);
  const isLoadingRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSavesRef = useRef<Map<string, CapturedRequest[]>>(new Map());
  
  // Captured requests - now persisted per workspace/mock-api/endpoint
  const [capturedRequests, setCapturedRequests] = useState<CapturedRequest[]>([]);
  
  // Active mock API ID is UI state - stays in localStorage
  const [activeMockApiId, setActiveMockApiId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_MOCK_API_ID);
      return stored ? stored : null;
    } catch {
      return null;
    }
  });

  // Load mock APIs from disk on mount
  useEffect(() => {
    const loadMockApis = async () => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      
      try {
        // Load mock APIs
        const storedApis = await fileStorageManager.readDataFile<MockAPI[]>(MOCK_APIS_FILE);
        if (storedApis && Array.isArray(storedApis)) {
          // Reset isRunning to false on initialization since servers don't persist across reloads
          setMockApis(storedApis.map(api => ({ ...api, isRunning: false })));
        }
      } catch (error) {
        console.error('Failed to load mock APIs from disk:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    
    loadMockApis();
  }, []);

  // Load captured requests from workspace when workspace or mock APIs change
  useEffect(() => {
    const loadCapturedRequests = async () => {
      if (!activeWorkspace || mockApis.length === 0) {
        setIsRequestsLoaded(true);
        return;
      }
      
      try {
        const allRequests: CapturedRequest[] = [];
        
        // Load requests for each mock API
        for (const api of mockApis) {
          const endpointData = await fileStorageManager.readAllMockRequests<CapturedRequest[]>(
            activeWorkspace.name,
            api.name
          );
          
          for (const { requests } of endpointData) {
            if (requests && Array.isArray(requests)) {
              allRequests.push(...requests);
            }
          }
        }
        
        // Sort by timestamp (newest first)
        allRequests.sort((a, b) => b.timestamp - a.timestamp);
        
        console.log(`[MockingContext] Loaded ${allRequests.length} captured requests from workspace: ${activeWorkspace.name}`);
        setCapturedRequests(allRequests.slice(0, maxCapturedRequests));
      } catch (error) {
        console.error('Failed to load captured requests from workspace:', error);
      } finally {
        setIsRequestsLoaded(true);
      }
    };
    
    loadCapturedRequests();
  }, [activeWorkspace, mockApis.length, maxCapturedRequests]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [localHostname, setLocalHostname] = useState<string>('localhost.local');
  const [pendingCloudRequests, setPendingCloudRequests] = useState<CloudProxyRequest[]>([]);

  // Get local hostname on mount
  useEffect(() => {
    const getHostname = async () => {
      if (window.electronAPI?.getLocalHostname) {
        try {
          const hostname = await window.electronAPI.getLocalHostname();
          setLocalHostname(hostname);
        } catch {
          setLocalHostname('localhost.local');
        }
      }
    };
    getHostname();
  }, []);

  // Listen for captured requests from main process (local server)
  useEffect(() => {
    if (window.electronAPI?.onMockRequestReceived) {
      const unsubscribe = window.electronAPI.onMockRequestReceived((request: CapturedRequest) => {
        setCapturedRequests(prev => [request, ...prev].slice(0, maxCapturedRequests));
      });
      return unsubscribe;
    }
  }, [maxCapturedRequests]);

  // Listen for cloud proxy status changes
  useEffect(() => {
    if (window.electronAPI?.onCloudProxyStatusChanged) {
      const unsubscribe = window.electronAPI.onCloudProxyStatusChanged((event) => {
        // Find and update the mock API with matching namespace
        setMockApis(prev => prev.map(api => {
          if (api.cloudNamespace === event.namespace) {
            return { ...api, cloudStatus: event.status as CloudProxyStatus };
          }
          return api;
        }));
      });
      return unsubscribe;
    }
  }, []);

  // Listen for cloud proxy requests
  useEffect(() => {
    if (window.electronAPI?.onCloudProxyRequestReceived) {
      const unsubscribe = window.electronAPI.onCloudProxyRequestReceived((request: CloudProxyRequest) => {
        // Add to pending requests
        setPendingCloudRequests(prev => [request, ...prev].slice(0, 50));
        
        // Also add to captured requests for display
        const activeMockApi = mockApis.find(api => api.cloudStatus === 'connected');
        if (activeMockApi) {
          const capturedRequest: CapturedRequest = {
            id: request.id,
            mockApiId: activeMockApi.id,
            method: request.method,
            path: request.path,
            url: request.path,
            headers: Object.entries(request.headers).map(([key, value]) => ({ key, value })),
            queryParams: request.query,
            body: request.body,
            timestamp: Date.now(),
            isMocked: false,
          };
          setCapturedRequests(prev => [capturedRequest, ...prev].slice(0, maxCapturedRequests));
        }
      });
      return unsubscribe;
    }
  }, [mockApis, maxCapturedRequests]);

  // Listen for forwarded responses (man-in-the-middle view)
  useEffect(() => {
    if (window.electronAPI?.onCloudProxyForwardedResponse) {
      const unsubscribe = window.electronAPI.onCloudProxyForwardedResponse((response) => {
        const source = response.servedByMock ? 'mocked' : 'forwarded';
        console.log(`[MockingContext] Received ${source} response:`, response.method, response.path, response.status);
        
        // Update the most recent captured request with matching method/path with the response
        setCapturedRequests(prev => {
          // Find the most recent request with matching method and path that doesn't have a response yet
          const index = prev.findIndex(req => 
            req.method === response.method && 
            req.path === response.path && 
            !req.response
          );
          
          if (index === -1) return prev;
          
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: Object.entries(response.headers).map(([key, value]) => ({ key, value })),
              body: response.body || '',
              duration: response.timestamp - updated[index].timestamp,
              servedByMock: response.servedByMock,
            },
          };
          return updated;
        });
      });
      return unsubscribe;
    }
  }, []);

  // Persist mock APIs to disk
  useEffect(() => {
    // Only persist after initial load to avoid overwriting with empty array
    if (!isLoaded) return;
    
    fileStorageManager.writeDataFile(MOCK_APIS_FILE, mockApis).catch(error => {
      console.error('Failed to save mock APIs to disk:', error);
    });
  }, [mockApis, isLoaded]);

  // Persist captured requests to disk (debounced, per mock API and endpoint)
  useEffect(() => {
    // Only persist after initial load and when workspace is available
    if (!isRequestsLoaded || !activeWorkspace) return;
    
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounce save operation
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Group requests by mock API and endpoint
        const requestsByApiAndEndpoint = new Map<string, Map<string, CapturedRequest[]>>();
        
        for (const request of capturedRequests) {
          const api = mockApis.find(a => a.id === request.mockApiId);
          if (!api) continue;
          
          if (!requestsByApiAndEndpoint.has(api.name)) {
            requestsByApiAndEndpoint.set(api.name, new Map());
          }
          
          const endpointMap = requestsByApiAndEndpoint.get(api.name)!;
          if (!endpointMap.has(request.path)) {
            endpointMap.set(request.path, []);
          }
          endpointMap.get(request.path)!.push(request);
        }
        
        // Save each group to its own file
        for (const [apiName, endpointMap] of requestsByApiAndEndpoint) {
          for (const [endpoint, requests] of endpointMap) {
            await fileStorageManager.writeMockRequests(
              activeWorkspace.name,
              apiName,
              endpoint,
              requests
            );
          }
        }
      } catch (error) {
        console.error('Failed to save captured requests to workspace:', error);
      }
    }, saveDebounceMs);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [capturedRequests, isRequestsLoaded, saveDebounceMs, activeWorkspace, mockApis]);

  // Persist active mock API ID
  useEffect(() => {
    if (activeMockApiId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_MOCK_API_ID, activeMockApiId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_MOCK_API_ID);
    }
  }, [activeMockApiId]);

  const addMockApi = useCallback((name: string): MockAPI => {
    const newMockApi: MockAPI = {
      id: uuidv4(),
      name,
      endpoint: localHostname, // Already includes .local suffix
      port: DEFAULT_PORT + mockApis.length,
      isLocal: true,
      isRunning: false,
      routes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setMockApis(prev => [...prev, newMockApi]);
    return newMockApi;
  }, [localHostname, mockApis.length]);

  const updateMockApi = useCallback((id: string, updates: Partial<MockAPI>) => {
    setMockApis(prev => prev.map(api => 
      api.id === id ? { ...api, ...updates, updatedAt: Date.now() } : api
    ));
  }, []);

  const deleteMockApi = useCallback((id: string) => {
    // Stop server if running
    const api = mockApis.find(a => a.id === id);
    if (api?.isRunning && window.electronAPI?.stopMockServer) {
      window.electronAPI.stopMockServer(id);
    }
    setMockApis(prev => prev.filter(api => api.id !== id));
    setCapturedRequests(prev => prev.filter(req => req.mockApiId !== id));
    if (activeMockApiId === id) {
      setActiveMockApiId(null);
    }
  }, [mockApis, activeMockApiId]);

  const setActiveMockApi = useCallback((id: string | null) => {
    setActiveMockApiId(id);
    setSelectedRequestId(null);
  }, []);

  const startMockServer = useCallback(async (mockApiId: string): Promise<boolean> => {
    const api = mockApis.find(a => a.id === mockApiId);
    if (!api || !window.electronAPI?.startMockServer) return false;

    try {
      const success = await window.electronAPI.startMockServer({
        id: api.id,
        port: api.port,
        routes: api.routes,
      });
      if (success) {
        updateMockApi(mockApiId, { isRunning: true });
      }
      return success;
    } catch (error) {
      console.error('Failed to start mock server:', error);
      return false;
    }
  }, [mockApis, updateMockApi]);

  const stopMockServer = useCallback(async (mockApiId: string): Promise<boolean> => {
    if (!window.electronAPI?.stopMockServer) return false;

    try {
      const success = await window.electronAPI.stopMockServer(mockApiId);
      if (success) {
        updateMockApi(mockApiId, { isRunning: false });
      }
      return success;
    } catch (error) {
      console.error('Failed to stop mock server:', error);
      return false;
    }
  }, [updateMockApi]);

  // Cloud Proxy functions
  const setMockMode = useCallback((mockApiId: string, mode: MockMode) => {
    updateMockApi(mockApiId, { mode });
  }, [updateMockApi]);

  const connectCloudProxy = useCallback(async (mockApiId: string): Promise<{ success: boolean; error?: string }> => {
    const api = mockApis.find(a => a.id === mockApiId);
    if (!api || !window.electronAPI?.cloudProxyConnect) {
      return { success: false, error: 'Mock API not found or cloud proxy not available' };
    }

    const serverUrl = api.cloudServerUrl || DEFAULT_CLOUD_SERVER_URL;
    const namespace = api.cloudNamespace || api.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    updateMockApi(mockApiId, { cloudStatus: 'connecting' });

    try {
      // First, fetch existing mocks from the server
      if (window.electronAPI?.cloudProxyFetchMocks) {
        console.log('[CloudProxy] Fetching existing mocks from server...');
        const fetchResult = await window.electronAPI.cloudProxyFetchMocks(serverUrl, namespace);
        
        if (fetchResult.success && fetchResult.mocks.length > 0) {
          console.log(`[CloudProxy] Found ${fetchResult.mocks.length} mocks on server, merging with local...`);
          // Convert server mocks to routes and merge with local
          const serverRoutes = fetchResult.mocks.map(storedMockToRoute);
          
          // Merge: use server mocks, but keep local ones that aren't on server
          const mergedRoutes = [...serverRoutes];
          api.routes.forEach(localRoute => {
            if (!serverRoutes.find(sr => sr.id === localRoute.id)) {
              mergedRoutes.push(localRoute);
            }
          });
          
          // Update local routes with merged data
          setMockApis(prev => prev.map(a => 
            a.id === mockApiId ? { ...a, routes: mergedRoutes } : a
          ));
        }
      }

      // Connect to proxy
      const userId = getOrCreateUserId();
      const result = await window.electronAPI.cloudProxyConnect({
        serverUrl,
        namespace,
        userId,
        forwardTo: api.cloudForwardTo,
      });

      if (result.success) {
        // After successful connection, sync local mocks to server
        if (window.electronAPI?.cloudProxySyncMocks) {
          const currentApi = mockApis.find(a => a.id === mockApiId);
          if (currentApi) {
            const mocksToSync = currentApi.routes
              .map(routeToStoredMock)
              .filter((m): m is CloudStoredMock => m !== null);
            
            if (mocksToSync.length > 0) {
              console.log(`[CloudProxy] Syncing ${mocksToSync.length} mocks to server...`);
              await window.electronAPI.cloudProxySyncMocks(serverUrl, namespace, mocksToSync);
            }
          }
        }

        updateMockApi(mockApiId, { 
          cloudStatus: 'connected',
          cloudNamespace: namespace,
          cloudServerUrl: serverUrl,
          isRunning: true,
        });
      } else {
        updateMockApi(mockApiId, { cloudStatus: 'error' });
      }

      return result;
    } catch (error) {
      console.error('Failed to connect cloud proxy:', error);
      updateMockApi(mockApiId, { cloudStatus: 'error' });
      return { success: false, error: (error as Error).message };
    }
  }, [mockApis, updateMockApi]);

  const disconnectCloudProxy = useCallback(async (mockApiId: string): Promise<void> => {
    if (!window.electronAPI?.cloudProxyDisconnect) return;

    try {
      await window.electronAPI.cloudProxyDisconnect();
      updateMockApi(mockApiId, { 
        cloudStatus: 'disconnected',
        isRunning: false,
      });
    } catch (error) {
      console.error('Failed to disconnect cloud proxy:', error);
    }
  }, [updateMockApi]);

  const checkNamespaceAvailability = useCallback(async (namespace: string, serverUrl?: string): Promise<{ available: boolean; connected: boolean }> => {
    if (!window.electronAPI?.cloudProxyCheckNamespace) {
      return { available: true, connected: false };
    }

    try {
      return await window.electronAPI.cloudProxyCheckNamespace(
        serverUrl || DEFAULT_CLOUD_SERVER_URL,
        namespace
      );
    } catch (error) {
      console.error('Failed to check namespace:', error);
      return { available: true, connected: false };
    }
  }, []);

  const sendCloudProxyResponse = useCallback((response: CloudProxyResponse) => {
    if (window.electronAPI?.cloudProxySendResponse) {
      window.electronAPI.cloudProxySendResponse(response);
      // Remove from pending requests
      setPendingCloudRequests(prev => prev.filter(r => r.id !== response.id));
    }
  }, []);

  const addRoute = useCallback((mockApiId: string, method: HttpMethod, path: string) => {
    const newRoute: MockRoute = {
      id: uuidv4(),
      method,
      path,
      isMocked: false,
    };
    setMockApis(prev => prev.map(api => 
      api.id === mockApiId 
        ? { ...api, routes: [...api.routes, newRoute], updatedAt: Date.now() }
        : api
    ));
  }, []);

  const updateRoute = useCallback((mockApiId: string, routeId: string, updates: Partial<MockRoute>) => {
    setMockApis(prev => prev.map(api => 
      api.id === mockApiId 
        ? {
            ...api,
            routes: api.routes.map(route => 
              route.id === routeId ? { ...route, ...updates } : route
            ),
            updatedAt: Date.now(),
          }
        : api
    ));
  }, []);

  const deleteRoute = useCallback((mockApiId: string, routeId: string) => {
    setMockApis(prev => prev.map(api => 
      api.id === mockApiId 
        ? { ...api, routes: api.routes.filter(r => r.id !== routeId), updatedAt: Date.now() }
        : api
    ));
  }, []);

  const setMockedResponse = useCallback((mockApiId: string, routeId: string, response: MockedResponse) => {
    setMockApis(prev => prev.map(api => 
      api.id === mockApiId 
        ? {
            ...api,
            routes: api.routes.map(route => 
              route.id === routeId 
                ? { ...route, mockedResponse: response, isMocked: true }
                : route
            ),
            updatedAt: Date.now(),
          }
        : api
    ));

    const api = mockApis.find(a => a.id === mockApiId);
    if (!api?.isRunning) return;

    // For cloud mode: upload mock to proxy server
    if (api.mode === 'cloud' && api.cloudServerUrl && api.cloudNamespace) {
      const route = api.routes.find(r => r.id === routeId);
      if (route && window.electronAPI?.cloudProxyUploadMock) {
        const updatedRoute = { ...route, mockedResponse: response, isMocked: true };
        const storedMock = routeToStoredMock(updatedRoute);
        if (storedMock) {
          console.log(`[CloudProxy] Uploading mock to server: ${storedMock.method} ${storedMock.path}`);
          window.electronAPI.cloudProxyUploadMock(
            api.cloudServerUrl,
            api.cloudNamespace,
            storedMock
          );
        }
      }
    }
    // For local mode: update routes on local mock server
    else if (window.electronAPI?.updateMockRoutes) {
      const updatedApi = {
        ...api,
        routes: api.routes.map(route => 
          route.id === routeId 
            ? { ...route, mockedResponse: response, isMocked: true }
            : route
        ),
      };
      window.electronAPI.updateMockRoutes(mockApiId, updatedApi.routes);
    }
  }, [mockApis]);

  const selectRequest = useCallback((id: string | null) => {
    setSelectedRequestId(id);
  }, []);

  const clearCapturedRequests = useCallback((mockApiId?: string) => {
    if (mockApiId) {
      setCapturedRequests(prev => prev.filter(req => req.mockApiId !== mockApiId));
      // Clear from disk for specific mock API
      if (activeWorkspace) {
        const api = mockApis.find(a => a.id === mockApiId);
        if (api) {
          fileStorageManager.deleteMockApiData(activeWorkspace.name, api.name).catch(error => {
            console.error('Failed to clear mock API data from disk:', error);
          });
        }
      }
    } else {
      setCapturedRequests([]);
      // Clear all mocking data for the workspace
      if (activeWorkspace) {
        fileStorageManager.clearMockingData(activeWorkspace.name).catch(error => {
          console.error('Failed to clear mocking data from disk:', error);
        });
      }
    }
  }, [activeWorkspace, mockApis]);

  const deleteCapturedRequest = useCallback((requestId: string) => {
    // If this request is selected, deselect it
    if (selectedRequestId === requestId) {
      setSelectedRequestId(null);
    }
    setCapturedRequests(prev => prev.filter(req => req.id !== requestId));
  }, [selectedRequestId]);

  const mockFromCapturedRequest = useCallback((requestId: string, response: MockedResponse) => {
    const request = capturedRequests.find(r => r.id === requestId);
    if (!request) return;

    // Find or create route
    const api = mockApis.find(a => a.id === request.mockApiId);
    if (!api) return;

    const existingRoute = api.routes.find(r => 
      r.method === request.method && r.path === request.path
    );

    if (existingRoute) {
      setMockedResponse(request.mockApiId, existingRoute.id, response);
    } else {
      // Create new route with mocked response
      const newRoute: MockRoute = {
        id: uuidv4(),
        method: request.method,
        path: request.path,
        mockedResponse: response,
        isMocked: true,
      };
      setMockApis(prev => prev.map(a => 
        a.id === request.mockApiId 
          ? { ...a, routes: [...a.routes, newRoute], updatedAt: Date.now() }
          : a
      ));

      // Upload to cloud proxy if in cloud mode
      if (api.mode === 'cloud' && api.isRunning && api.cloudServerUrl && api.cloudNamespace) {
        const storedMock = routeToStoredMock(newRoute);
        if (storedMock && window.electronAPI?.cloudProxyUploadMock) {
          console.log(`[CloudProxy] Uploading new mock: ${storedMock.method} ${storedMock.path}`);
          window.electronAPI.cloudProxyUploadMock(
            api.cloudServerUrl,
            api.cloudNamespace,
            storedMock
          );
        }
      }
    }

    // Mark captured request as mocked
    setCapturedRequests(prev => prev.map(r => 
      r.id === requestId ? { ...r, isMocked: true } : r
    ));
  }, [capturedRequests, mockApis, setMockedResponse]);

  const toggleRequestMock = useCallback((requestId: string, enabled: boolean) => {
    const request = capturedRequests.find(r => r.id === requestId);
    if (!request) return;

    // Find the associated route
    const api = mockApis.find(a => a.id === request.mockApiId);
    
    if (api) {
      const route = api.routes.find(r => 
        r.method === request.method && r.path === request.path
      );

      if (route) {
        // Toggle the route's isMocked state
        setMockApis(prev => prev.map(a => 
          a.id === request.mockApiId 
            ? {
                ...a, 
                routes: a.routes.map(r => 
                  r.id === route.id ? { ...r, isMocked: enabled } : r
                ),
                updatedAt: Date.now()
              }
            : a
        ));

        // Update routes on server if running
        if (api.isRunning) {
          // For cloud mode: update mock on proxy server
          if (api.mode === 'cloud' && api.cloudServerUrl && api.cloudNamespace) {
            const updatedRoute = { ...route, isMocked: enabled };
            if (enabled && updatedRoute.mockedResponse) {
              // Upload mock when enabling
              const storedMock = routeToStoredMock(updatedRoute);
              if (storedMock && window.electronAPI?.cloudProxyUploadMock) {
                console.log(`[CloudProxy] Enabling mock: ${storedMock.method} ${storedMock.path}`);
                window.electronAPI.cloudProxyUploadMock(
                  api.cloudServerUrl,
                  api.cloudNamespace,
                  storedMock
                );
              }
            } else if (!enabled && window.electronAPI?.cloudProxyDeleteMock) {
              // Delete mock when disabling
              console.log(`[CloudProxy] Disabling mock: ${route.method} ${route.path}`);
              window.electronAPI.cloudProxyDeleteMock(
                api.cloudServerUrl,
                api.cloudNamespace,
                route.id
              );
            }
          }
          // For local mode: update routes on local mock server
          else if (window.electronAPI?.updateMockRoutes) {
            const updatedRoutes = api.routes.map(r => 
              r.id === route.id ? { ...r, isMocked: enabled } : r
            );
            window.electronAPI.updateMockRoutes(api.id, updatedRoutes);
          }
        }
      }
    }

    // Always update captured request state
    setCapturedRequests(prev => prev.map(r => 
      r.id === requestId ? { ...r, isMocked: enabled } : r
    ));
  }, [capturedRequests, mockApis]);

  const updateCapturedRequestResponse = useCallback((requestId: string, updates: Partial<MockedResponse>) => {
    setCapturedRequests(prev => prev.map(r => {
      if (r.id !== requestId) return r;
      
      const currentResponse = r.response || { 
        status: 200, 
        statusText: 'OK', 
        headers: [], 
        body: '',
        duration: 0 
      };
      
      return {
        ...r,
        response: {
          ...currentResponse,
          status: updates.status ?? currentResponse.status,
          statusText: updates.statusText ?? currentResponse.statusText,
          headers: updates.headers ?? currentResponse.headers,
          body: updates.body ?? currentResponse.body,
        }
      };
    }));

    // Also update the route if it exists
    const request = capturedRequests.find(r => r.id === requestId);
    if (!request) return;

    const api = mockApis.find(a => a.id === request.mockApiId);
    if (!api) return;

    const route = api.routes.find(r => 
      r.method === request.method && r.path === request.path
    );

    if (route && route.mockedResponse) {
      const updatedResponse: MockedResponse = {
        status: updates.status ?? route.mockedResponse.status,
        statusText: updates.statusText ?? route.mockedResponse.statusText,
        headers: updates.headers ?? route.mockedResponse.headers,
        body: updates.body ?? route.mockedResponse.body,
        delay: updates.delay ?? route.mockedResponse.delay,
      };
      setMockedResponse(request.mockApiId, route.id, updatedResponse);
    }
  }, [capturedRequests, mockApis, setMockedResponse]);

  // Auto-reconnect to cloud proxy on app reload if previously connected
  useEffect(() => {
    if (!activeMockApiId) return;
    
    const api = mockApis.find(a => a.id === activeMockApiId);
    if (!api) return;
    
    // Only auto-reconnect if in cloud mode with valid config
    if (api.mode === 'cloud' && api.cloudNamespace && api.cloudServerUrl) {
      // Small delay to ensure all components are ready
      const timer = setTimeout(() => {
        console.log('[MockingContext] Auto-reconnecting to cloud proxy for:', api.cloudNamespace);
        connectCloudProxy(activeMockApiId);
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const contextValue = useMemo(() => ({
    mockApis,
    activeMockApiId,
    capturedRequests,
    selectedRequestId,
    localHostname,
    pendingCloudRequests,
    addMockApi,
    updateMockApi,
    deleteMockApi,
    setActiveMockApi,
    startMockServer,
    stopMockServer,
    setMockMode,
    connectCloudProxy,
    disconnectCloudProxy,
    checkNamespaceAvailability,
    sendCloudProxyResponse,
    addRoute,
    updateRoute,
    deleteRoute,
    setMockedResponse,
    selectRequest,
    clearCapturedRequests,
    deleteCapturedRequest,
    mockFromCapturedRequest,
    toggleRequestMock,
    updateCapturedRequestResponse,
  }), [
    mockApis,
    activeMockApiId,
    capturedRequests,
    selectedRequestId,
    localHostname,
    pendingCloudRequests,
    addMockApi,
    updateMockApi,
    deleteMockApi,
    setActiveMockApi,
    startMockServer,
    stopMockServer,
    setMockMode,
    connectCloudProxy,
    disconnectCloudProxy,
    checkNamespaceAvailability,
    sendCloudProxyResponse,
    addRoute,
    updateRoute,
    deleteRoute,
    setMockedResponse,
    selectRequest,
    clearCapturedRequests,
    deleteCapturedRequest,
    mockFromCapturedRequest,
    toggleRequestMock,
    updateCapturedRequestResponse,
  ]);

  return (
    <MockingContext.Provider value={contextValue}>
      {children}
    </MockingContext.Provider>
  );
};

export const useMocking = () => {
  const context = useContext(MockingContext);
  if (!context) {
    throw new Error('useMocking must be used within MockingProvider');
  }
  return context;
};

export default MockingContext;

