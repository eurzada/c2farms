export function getGridColors(mode) {
  if (mode === 'dark') {
    return {
      parentRow: '#2c2c2c',
      actualCell: '#1b3a1b',
      computedBg: '#1a237e',
      computedBorder: '#5c6bc0',
      aggregateBg: '#0d2137',
      forecastBg: '#2e1a00',
      totalBg: '#0d2137',
      totalComputedBg: '#1a237e',
      positiveText: '#66bb6a',
      negativeText: '#ef5350',
      moduleDrivenText: '#5c9dc4',
      mutedText: '#999',
      priorYearBg: '#1e1e1e',
      priorYearText: '#999',
      cashFlowPositiveBg: '#1b3a1b',
      cashFlowPositiveBorder: '#388e3c',
      cashFlowNegativeBg: '#3a1b1b',
      cashFlowNegativeBorder: '#d32f2f',
    };
  }

  return {
    parentRow: '#f5f5f5',
    actualCell: '#e8f5e9',
    computedBg: '#e8eaf6',
    computedBorder: '#3f51b5',
    aggregateBg: '#e3f2fd',
    forecastBg: '#fff3e0',
    totalBg: '#e3f2fd',
    totalComputedBg: '#c5cae9',
    positiveText: '#2e7d32',
    negativeText: '#d32f2f',
    moduleDrivenText: '#2979b0',
    mutedText: '#666',
    priorYearBg: '#fafafa',
    priorYearText: '#666',
    cashFlowPositiveBg: '#e8f5e9',
    cashFlowPositiveBorder: '#a5d6a7',
    cashFlowNegativeBg: '#ffebee',
    cashFlowNegativeBorder: '#ef9a9a',
  };
}
