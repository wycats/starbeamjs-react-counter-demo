import './App.css';
import { useStarbeam } from '@starbeam/react';
import { Cell } from '@starbeam/core';

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
