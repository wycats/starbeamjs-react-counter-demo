import './App.css';
import { useStarbeam, Cell } from './vendor/starbeam-react.js';

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
