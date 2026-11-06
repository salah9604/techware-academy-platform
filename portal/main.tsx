import React from 'react';
import {createRoot} from 'react-dom/client';
import LoginScreen from '../app/login/login-screen';
import '../app/globals.css';

// Always require authentication, including old /demo links.
if(location.pathname==='/demo')window.history.replaceState(null,'','/');
createRoot(document.getElementById('root')!).render(<LoginScreen/>);
