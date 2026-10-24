import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'portal',publicDir:'../public',plugins:[react()],server:{port:5173},build:{outDir:'../dist-portal',emptyOutDir:true}});
