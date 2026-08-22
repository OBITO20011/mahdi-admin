import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StoreErrorBoundary } from './components/StoreErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreErrorBoundary>
      <App />
    </StoreErrorBoundary>
  </React.StrictMode>
);
