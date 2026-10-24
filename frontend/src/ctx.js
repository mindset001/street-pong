import { createContext, useContext } from 'react';

export const AppCtx = createContext(null);
export const useAppCtx = () => useContext(AppCtx);
