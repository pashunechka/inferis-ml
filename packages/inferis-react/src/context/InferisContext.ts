import { createContext } from 'react';
import type { InferisContextValue } from '../types.js';

export const InferisContext = createContext<InferisContextValue | null>(null);
