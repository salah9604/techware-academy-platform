import React from 'react';
import {createRoot} from 'react-dom/client';
import WaitingListApp from './WaitingListApp';
import './base.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><WaitingListApp/></React.StrictMode>);
