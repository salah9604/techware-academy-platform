import React from 'react';
import {createRoot} from 'react-dom/client';
import LoginScreen from '../app/login/login-screen';
import WaitingListApp from '../app/waiting-list';
import '../app/globals.css';

// Always require authentication, including old /demo links.
if(location.pathname==='/demo')window.history.replaceState(null,'','/');
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/waiting-list')?<WaitingListApp/>:<LoginScreen/>);
