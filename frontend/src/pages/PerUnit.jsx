import { useState, useEffect } from 'react';
import { Typography, Box, Tabs, Tab } from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import EditIcon from '@mui/icons-material/Edit';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PerUnitGrid from '../components/per-unit/PerUnitGrid';
import ActualsGrid from '../components/shared/ActualsGrid';
import VarianceGrid from '../components/shared/VarianceGrid';
import TabPanel from '../components/shared/TabPanel';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function PerUnit() {
  const { currentFarm, fiscalYear } = useFarm();
  const [tab, setTab] = useState(0);
  const [varianceData, setVarianceData] = useState(null);

  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear || tab !== 0) return;
    api.get(`/api/farms/${currentFarm.id}/variance/${fiscalYear}`)
      .then(res => setVarianceData(res.data))
      .catch(() => setVarianceData(null));
  }, [currentFarm?.id, fiscalYear, tab]);

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No farm selected.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Per Acre Analysis ($/acre)
      </Typography>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<CompareArrowsIcon />} iconPosition="start" label="Variance" />
          <Tab icon={<EditIcon />} iconPosition="start" label="Plan" />
          <Tab icon={<ReceiptLongIcon />} iconPosition="start" label="Actuals" />
        </Tabs>
      </Box>
      <TabPanel value={tab} index={0}>
        <VarianceGrid data={varianceData} mode="per-acre" />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <PerUnitGrid farmId={currentFarm.id} fiscalYear={fiscalYear} />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <ActualsGrid mode="per-unit" />
      </TabPanel>
    </Box>
  );
}
