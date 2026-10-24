import React from 'react';
import {createRoot} from 'react-dom/client';
import LoginScreen from '../app/login/login-screen';
import Platform from '../app/platform';
import '../app/globals.css';
(window as Window & {__TECHWARE_STATIC__?:boolean}).__TECHWARE_STATIC__=true;
createRoot(document.getElementById('root')!).render(location.pathname==='/demo'?<Platform/>:<LoginScreen/>);
