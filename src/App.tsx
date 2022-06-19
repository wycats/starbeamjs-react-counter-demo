import { useState } from 'react';
import viteLogo from '/vite.svg';
import reactLogo from './assets/react.svg';
import './App.css';
import { useStarbeam, reactive, Cell } from './vendor/starbeam-react.js';

interface Person {
  id: string;
  name: string;
  location: string;
}

function App() {
  return useStarbeam(() => {
    const counter = Cell(0);

    return () => (
      <>
        <p>{counter.current}</p>
        <button onClick={() => counter.current++}>++</button>
      </>
    );
  });
}

export default App;
