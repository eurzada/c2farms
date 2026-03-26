import { useState } from 'react';
import { Box } from '@mui/material';
import Header from './Header';
import Sidebar from './Sidebar';
import AgentChat from '../shared/AgentChat';

const DRAWER_WIDTH = 240;
const CHAT_WIDTH = 420;

export default function AppLayout({ children }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar width={DRAWER_WIDTH} />
      <Box sx={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        transition: 'margin-right 225ms cubic-bezier(0, 0, 0.2, 1)',
        marginRight: chatOpen ? `${CHAT_WIDTH}px` : 0,
      }}>
        <Header onToggleChat={() => setChatOpen(prev => !prev)} chatOpen={chatOpen} />
        <Box component="main" sx={{ flexGrow: 1, p: 3, bgcolor: 'background.default' }}>
          {children}
        </Box>
      </Box>
      <AgentChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </Box>
  );
}
