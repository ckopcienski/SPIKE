import React, {useEffect} from 'react';
import {initStorage} from './src/storage/storage';
import AppNavigator from './src/navigation/AppNavigator';
import {ThemeProvider} from './src/theme';

export default function App() {
  useEffect(() => {
    initStorage();
  }, []);

  return (
    <ThemeProvider>
      <AppNavigator />
    </ThemeProvider>
  );
}
