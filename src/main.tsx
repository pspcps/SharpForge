import {createRoot} from 'react-dom/client';
import { CrashBoundary } from './components/CrashBoundary';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<CrashBoundary><App /></CrashBoundary>);
