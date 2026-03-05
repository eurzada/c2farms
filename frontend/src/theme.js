import { createTheme } from '@mui/material/styles';

// C2 Farms brand palette — from c2farms.ca
const C2_TEAL = '#008CB2';
const C2_TEAL_DARK = '#006E8C';
const C2_TEAL_LIGHT = '#4DB8D4';
const C2_CHARCOAL = '#414042';
const C2_DARK = '#272727';
const C2_ACCENT = '#ff2a13';

export function getThemeOptions(mode) {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: C2_TEAL,
        dark: C2_TEAL_DARK,
        light: C2_TEAL_LIGHT,
        contrastText: '#ffffff',
      },
      secondary: {
        main: C2_CHARCOAL,
        light: '#6d6e70',
        dark: C2_DARK,
        contrastText: '#ffffff',
      },
      ...(mode === 'light'
        ? {
            background: { default: '#f5f6f8', paper: '#ffffff' },
            text: { primary: C2_DARK, secondary: '#6d6e70' },
          }
        : {
            background: { default: '#121212', paper: '#1e1e1e' },
          }),
      success: { main: '#4caf50' },
      warning: { main: '#ff9800' },
      error: { main: C2_ACCENT },
      info: { main: C2_TEAL },
    },
    typography: {
      fontFamily: '"Open Sans", "Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 8, fontWeight: 600 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600 },
        },
      },
    },
  });
}

// Default export for backwards compat
const theme = getThemeOptions('light');
export default theme;
