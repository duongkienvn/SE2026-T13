import { createContext, useContext } from 'react';
import { workspaceGateway } from './api';

/** Tests and the separate QA entry can supply a gateway; app routes never do. */
export const WorkspaceGatewayContext = createContext(workspaceGateway);
export const useWorkspaceGateway = () => useContext(WorkspaceGatewayContext);
