import React from 'react';
import './App.css';
import Player from './components/Player'

function App() {
  console.log('渲染')
  return (
    <div className="App">
      <Player />
    </div>
  );
}

export default React.memo(App);
