import './App.css';
import { useReactiveSetup } from '@starbeam/react';
import { Cell } from '@starbeam/core';

function App() {
  return useReactiveSetup(() => {
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
