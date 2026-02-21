/**
 * Centralized IPC Channel definitions
 * 
 * All IPC channels used between main process, preload, and renderer
 * should be defined here to avoid duplication and ensure consistency.
 */

// ==================== Update Channels ====================
export const UPDATE_CHANNELS = {
  CHECK_FOR_UPDATES: 'check-for-updates',
  UPDATE_AVAILABLE: 'update-available',
  UPDATE_NOT_AVAILABLE: 'update-not-available',
  UPDATE_DOWNLOADED: 'update-downloaded',
  UPDATE_ERROR: 'update-error',
  DOWNLOAD_UPDATE: 'download-update',
  INSTALL_UPDATE: 'install-update',
  QUIT_AND_INSTALL_LATER: 'quit-and-install-later',
  UPDATE_DOWNLOAD_PROGRESS: 'update-download-progress',
  SET_UPDATE_SERVER: 'set-update-server',
} as const;

// ==================== Core App Channels ====================
export const APP_CHANNELS = {
  GET_APP_VERSION: 'get-app-version',
  MAKE_HTTP_REQUEST: 'make-http-request',
  EXECUTE_SCRIPT: 'execute-script',
  OPEN_EXTERNAL: 'open-external',
  GET_LOGIN_ITEM_SETTINGS: 'get-login-item-settings',
  SET_LOGIN_ITEM_SETTINGS: 'set-login-item-settings',
  OPEN_SYSTEM_LOGIN_ITEMS: 'open-system-login-items',
  FETCH_URL_CONTENT: 'fetch-url-content',
  DEEP_LINK: 'app:deep-link',
  RESTART_APP: 'restart-app',
  WIPE_ALL_DATA: 'wipe-all-data',
  TOGGLE_DEV_TOOLS: 'toggle-dev-tools',
  COMPUTE_DIGEST_AUTH: 'compute-digest-auth',
  CAPTURE_PAGE: 'capture-page',
  COMPUTE_COMPRESSION_SIZES: 'compute-compression-sizes',
} as const;

// ==================== Mock Server Channels ====================
export const MOCK_SERVER_CHANNELS = {
  START_MOCK_SERVER: 'start-mock-server',
  STOP_MOCK_SERVER: 'stop-mock-server',
  GET_MOCK_SERVER_STATUS: 'get-mock-server-status',
  MOCK_REQUEST_RECEIVED: 'mock-request-received',
  UPDATE_MOCK_ROUTES: 'update-mock-routes',
  GET_LOCAL_HOSTNAME: 'get-local-hostname',
} as const;

// ==================== Cloud Proxy Channels ====================
export const CLOUD_PROXY_CHANNELS = {
  CONNECT: 'cloud-proxy-connect',
  DISCONNECT: 'cloud-proxy-disconnect',
  STATUS: 'cloud-proxy-status',
  STATUS_CHANGED: 'cloud-proxy-status-changed',
  REQUEST_RECEIVED: 'cloud-proxy-request-received',
  FORWARDED_RESPONSE: 'cloud-proxy-forwarded-response',
  SEND_RESPONSE: 'cloud-proxy-send-response',
  CHECK_NAMESPACE: 'cloud-proxy-check-namespace',
  // Mock management
  FETCH_MOCKS: 'cloud-proxy-fetch-mocks',
  UPLOAD_MOCK: 'cloud-proxy-upload-mock',
  DELETE_MOCK: 'cloud-proxy-delete-mock',
  SYNC_MOCKS: 'cloud-proxy-sync-mocks',
} as const;

// ==================== File Storage Channels ====================
export const FILE_STORAGE_CHANNELS = {
  // Initialization
  INIT_FILE_STORAGE: 'file-storage-init',
  GET_ECHOLON_PATH: 'file-storage-get-path',
  SET_ECHOLON_PATH: 'file-storage-set-path',
  SELECT_DIRECTORY: 'file-storage-select-directory',
  OPEN_IN_FILE_MANAGER: 'file-storage-open-in-file-manager',
  // Config
  READ_CONFIG: 'file-storage-read-config',
  WRITE_CONFIG: 'file-storage-write-config',
  UPDATE_CONFIG: 'file-storage-update-config',
  // Environments
  READ_ENVIRONMENTS: 'file-storage-read-environments',
  WRITE_ENVIRONMENTS: 'file-storage-write-environments',
  // Workspaces
  GET_ALL_WORKSPACES: 'file-storage-get-all-workspaces',
  CREATE_WORKSPACE: 'file-storage-create-workspace',
  READ_WORKSPACE: 'file-storage-read-workspace',
  UPDATE_WORKSPACE: 'file-storage-update-workspace',
  RENAME_WORKSPACE: 'file-storage-rename-workspace',
  DELETE_WORKSPACE: 'file-storage-delete-workspace',
  // Collections
  GET_ALL_COLLECTIONS: 'file-storage-get-all-collections',
  GET_ALL_COLLECTIONS_ALL_WORKSPACES: 'file-storage-get-all-collections-all-workspaces',
  READ_COLLECTION: 'file-storage-read-collection',
  WRITE_COLLECTION: 'file-storage-write-collection',
  DELETE_COLLECTION: 'file-storage-delete-collection',
  RENAME_COLLECTION: 'file-storage-rename-collection',
  SHOW_COLLECTION_IN_FINDER: 'file-storage-show-collection-in-finder',
  // File watching
  WATCH_DIRECTORY: 'file-storage-watch-directory',
  UNWATCH_DIRECTORY: 'file-storage-unwatch-directory',
  FILE_CHANGED: 'file-storage-file-changed',
  // Generic data files
  READ_DATA_FILE: 'file-storage-read-data-file',
  WRITE_DATA_FILE: 'file-storage-write-data-file',
  // Mocking data (per workspace/endpoint)
  READ_MOCK_REQUESTS: 'file-storage-read-mock-requests',
  WRITE_MOCK_REQUESTS: 'file-storage-write-mock-requests',
  READ_ALL_MOCK_REQUESTS: 'file-storage-read-all-mock-requests',
  READ_ALL_MOCKING_DATA: 'file-storage-read-all-mocking-data',
  DELETE_MOCK_API_DATA: 'file-storage-delete-mock-api-data',
  DELETE_MOCK_ENDPOINT_DATA: 'file-storage-delete-mock-endpoint-data',
  CLEAR_MOCKING_DATA: 'file-storage-clear-mocking-data',
  // OpenAPI export
  WRITE_COLLECTION_OPENAPI: 'file-storage-write-collection-openapi',
  READ_COLLECTION_OPENAPI: 'file-storage-read-collection-openapi',
  // Request history
  READ_HISTORY: 'file-storage-read-history',
  WRITE_HISTORY: 'file-storage-write-history',
  CLEAR_HISTORY: 'file-storage-clear-history',
  // Workspace data files (workspace-specific state)
  READ_WORKSPACE_DATA_FILE: 'file-storage-read-workspace-data-file',
  WRITE_WORKSPACE_DATA_FILE: 'file-storage-write-workspace-data-file',
  DELETE_WORKSPACE_DATA_FILE: 'file-storage-delete-workspace-data-file',
} as const;

// ==================== Git Channels ====================
export const GIT_CHANNELS = {
  // Repository operations
  INIT: 'git-init',
  IS_REPO: 'git-is-repo',
  CLONE: 'git-clone',
  // Status
  STATUS: 'git-status',
  // Staging
  ADD: 'git-add',
  ADD_ALL: 'git-add-all',
  UNSTAGE: 'git-unstage',
  DISCARD_CHANGES: 'git-discard-changes',
  // Commits
  COMMIT: 'git-commit',
  LOG: 'git-log',
  // Branches
  LIST_BRANCHES: 'git-list-branches',
  CURRENT_BRANCH: 'git-current-branch',
  CREATE_BRANCH: 'git-create-branch',
  CHECKOUT: 'git-checkout',
  DELETE_BRANCH: 'git-delete-branch',
  // Remotes
  LIST_REMOTES: 'git-list-remotes',
  ADD_REMOTE: 'git-add-remote',
  REMOVE_REMOTE: 'git-remove-remote',
  // Sync
  PUSH: 'git-push',
  PULL: 'git-pull',
  FETCH: 'git-fetch',
  // Credentials
  SET_CREDENTIALS: 'git-set-credentials',
  // Utils
  CREATE_GITIGNORE: 'git-create-gitignore',
  GET_FILE_FOR_DIFF: 'git-get-file-for-diff',
} as const;

// ==================== Public Specs Channels ====================
export const PUBLIC_SPECS_CHANNELS = {
  // S3 Operations
  CHECK_SUBDOMAIN: 'public-specs-check-subdomain',
  UPLOAD_SPEC: 'public-specs-upload-spec',
  GET_VERSIONS: 'public-specs-get-versions',
  DELETE_VERSION: 'public-specs-delete-version',
  DELETE_ROOT_FILES: 'public-specs-delete-root-files',
  // Manifest
  GET_MANIFEST: 'public-specs-get-manifest',
  UPDATE_MANIFEST: 'public-specs-update-manifest',
} as const;

// ==================== AirPlay Channels ====================
export const AIRPLAY_CHANNELS = {
  START_SERVER: 'airplay:start-server',
  STOP_SERVER: 'airplay:stop-server',
  GET_STATUS: 'airplay:get-status',
  STATUS_UPDATE: 'airplay:status-update',
  VIDEO_FRAME: 'airplay:video-frame',
  VIDEO_CODEC: 'airplay:video-codec',
  AUDIO_FRAME: 'airplay:audio-frame',
} as const;

// ==================== GitHub Channels ====================
export const GITHUB_CHANNELS = {
  // Authentication
  AUTH_WITH_PAT: 'github-auth-with-pat',
  START_OAUTH: 'github-start-oauth',
  LOGOUT: 'github-logout',
  GET_CURRENT_USER: 'github-get-current-user',
  IS_AUTHENTICATED: 'github-is-authenticated',
  SET_ACCESS_TOKEN: 'github-set-access-token',
  // Repositories
  LIST_REPOS: 'github-list-repos',
  GET_REPO: 'github-get-repo',
  CREATE_REPO: 'github-create-repo',
  // Branches
  LIST_BRANCHES: 'github-list-branches',
  GET_BRANCH: 'github-get-branch',
  CREATE_BRANCH: 'github-create-branch',
  // Commits
  LIST_COMMITS: 'github-list-commits',
  GET_COMMIT: 'github-get-commit',
  // Contents
  GET_CONTENTS: 'github-get-contents',
  CREATE_OR_UPDATE_FILE: 'github-create-or-update-file',
  DELETE_FILE: 'github-delete-file',
  // Comparison
  COMPARE_COMMITS: 'github-compare-commits',
  // Batch operations
  PUSH_CHANGES: 'github-push-changes',
  PULL_LATEST: 'github-pull-latest',
  // Workspace linking
  SETUP_WORKSPACE_GIT: 'github-setup-workspace-git',
} as const;

// ==================== Type exports ====================
export type UpdateChannel = typeof UPDATE_CHANNELS[keyof typeof UPDATE_CHANNELS];
export type AppChannel = typeof APP_CHANNELS[keyof typeof APP_CHANNELS];
export type MockServerChannel = typeof MOCK_SERVER_CHANNELS[keyof typeof MOCK_SERVER_CHANNELS];
export type CloudProxyChannel = typeof CLOUD_PROXY_CHANNELS[keyof typeof CLOUD_PROXY_CHANNELS];
export type FileStorageChannel = typeof FILE_STORAGE_CHANNELS[keyof typeof FILE_STORAGE_CHANNELS];
export type GitChannel = typeof GIT_CHANNELS[keyof typeof GIT_CHANNELS];
export type GitHubChannel = typeof GITHUB_CHANNELS[keyof typeof GITHUB_CHANNELS];
export type PublicSpecsChannel = typeof PUBLIC_SPECS_CHANNELS[keyof typeof PUBLIC_SPECS_CHANNELS];
export type AirPlayChannel = typeof AIRPLAY_CHANNELS[keyof typeof AIRPLAY_CHANNELS];

