import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Drawer, Box, Typography, TextField, IconButton, List, ListItemButton,
  ListItemText, CircularProgress, Paper, Chip, Tooltip, Fade,
  InputAdornment, useTheme, alpha,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BuildIcon from '@mui/icons-material/Build';
import api from '../../services/api';
import { useFarm } from '../../contexts/FarmContext';
import { extractErrorMessage } from '../../utils/errorHelpers';

const CHAT_WIDTH = 420;

// Tool name → friendly label
const TOOL_LABELS = {
  get_marketing_dashboard: 'Marketing overview',
  get_marketing_position: 'Grain position',
  get_commitment_matrix: 'Commitment matrix',
  get_delivered_unsettled: 'Unsettled deliveries',
  get_contract_fulfillment: 'Contract status',
  get_sell_analysis: 'Sell analysis',
  get_cash_flow: 'Cash flow',
  get_marketing_contracts: 'Contracts',
  get_inventory_dashboard: 'Inventory',
  get_tickets: 'Delivery tickets',
  get_settlements: 'Settlements',
  get_logistics_dashboard: 'Logistics',
  get_forecast: 'Forecast',
  get_variance_report: 'Budget variance',
  get_enterprise_rollup: 'Enterprise rollup',
  get_farm_context_summary: 'Farm context',
  get_agronomy_dashboard: 'Agronomy',
  get_procurement_summary: 'Procurement',
  get_labour_dashboard: 'Labour & fuel',
  get_terminal_dashboard: 'LGX terminal',
  get_monthly_recon: 'Monthly recon',
  list_farms: 'Farm list',
  list_commodities: 'Commodities',
};

function ToolCallChip({ toolName }) {
  const label = TOOL_LABELS[toolName] || toolName.replace(/^get_/, '').replace(/_/g, ' ');
  return (
    <Chip
      icon={<BuildIcon sx={{ fontSize: 14 }} />}
      label={`Checking ${label}...`}
      size="small"
      variant="outlined"
      color="info"
      sx={{ mb: 0.5, mr: 0.5, fontSize: 12 }}
    />
  );
}

function MessageBubble({ message, isUser, theme }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 1.5,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: '85%',
          p: 1.5,
          borderRadius: 2,
          bgcolor: isUser
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.grey[500], 0.08),
          border: `1px solid ${isUser
            ? alpha(theme.palette.primary.main, 0.2)
            : alpha(theme.palette.divider, 0.5)}`,
        }}
      >
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.6,
            '& strong': { fontWeight: 600 },
          }}
        >
          {message.content}
        </Typography>
        {message.tools_used?.length > 0 && (
          <Box sx={{ mt: 0.5 }}>
            {message.tools_used.map((t, i) => (
              <Chip
                key={i}
                label={TOOL_LABELS[t.name] || t.name}
                size="small"
                variant="outlined"
                sx={{ fontSize: 10, mr: 0.5, mb: 0.25 }}
              />
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  );
}

function ConversationList({ conversations, activeId, onSelect, onNew, onDelete }) {
  const theme = useTheme();

  const groupByDate = (convos) => {
    const today = new Date();
    const groups = { Today: [], 'This Week': [], Earlier: [] };
    for (const c of convos) {
      const d = new Date(c.updated_at || c.created_at);
      const diff = (today - d) / (1000 * 60 * 60 * 24);
      if (diff < 1) groups.Today.push(c);
      else if (diff < 7) groups['This Week'].push(c);
      else groups.Earlier.push(c);
    }
    return groups;
  };

  const groups = groupByDate(conversations);

  return (
    <Box sx={{ width: '100%', overflow: 'auto', flexGrow: 1 }}>
      <Box sx={{ p: 1 }}>
        <ListItemButton
          onClick={onNew}
          sx={{
            borderRadius: 2,
            border: `1px dashed ${theme.palette.divider}`,
            justifyContent: 'center',
            py: 0.75,
          }}
        >
          <AddIcon sx={{ fontSize: 18, mr: 0.5 }} />
          <Typography variant="body2" fontWeight={500}>New Chat</Typography>
        </ListItemButton>
      </Box>
      <List dense disablePadding>
        {Object.entries(groups).map(([label, items]) =>
          items.length > 0 && (
            <Box key={label}>
              <Typography variant="overline" sx={{ px: 2, pt: 1, display: 'block', color: 'text.disabled', fontSize: 10 }}>
                {label}
              </Typography>
              {items.map((c) => (
                <ListItemButton
                  key={c.id}
                  selected={c.id === activeId}
                  onClick={() => onSelect(c.id)}
                  sx={{
                    mx: 1, borderRadius: 1.5, mb: 0.25, py: 0.5,
                    '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.1) },
                  }}
                >
                  <ListItemText
                    primary={c.title || 'Untitled'}
                    primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                    secondary={`${c._count?.messages || 0} messages`}
                    secondaryTypographyProps={{ fontSize: 11 }}
                  />
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                    sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </ListItemButton>
              ))}
            </Box>
          )
        )}
      </List>
    </Box>
  );
}

export default function AgentChat({ open, onClose }) {
  const theme = useTheme();
  const { currentFarm, fiscalYear } = useFarm();
  const farmId = currentFarm?.id;

  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState([]); // active tool calls being streamed
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolCalls]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    if (!farmId) return;
    try {
      const { data } = await api.get(`/api/farms/${farmId}/ai/conversations`);
      setConversations(data.conversations || []);
    } catch {
      // Silently fail — not critical
    }
  }, [farmId]);

  useEffect(() => {
    if (open && farmId) loadConversations();
  }, [open, farmId, loadConversations]);

  // Load conversation messages
  const loadConversation = useCallback(async (conversationId) => {
    if (!farmId || !conversationId) return;
    try {
      const { data } = await api.get(`/api/farms/${farmId}/ai/conversations/${conversationId}`);
      setMessages((data.messages || []).map(m => ({
        role: m.role,
        content: m.content,
        tools_used: m.metadata_json?.tools_used,
      })));
      setActiveConversationId(conversationId);
      setShowHistory(false);
    } catch {
      // Conversation may have been deleted
    }
  }, [farmId]);

  // Send message using SSE streaming
  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || loading || !farmId) return;

    setInput('');
    setLoading(true);
    setToolCalls([]);
    setMessages(prev => [...prev, { role: 'user', content: msg }]);

    try {
      // Use fetch for SSE (axios doesn't support streaming well)
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/farms/${farmId}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          message: msg,
          conversation_id: activeConversationId,
          fiscal_year: fiscalYear,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let usedTools = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'tool_call':
                setToolCalls(prev => [...prev, event.tool]);
                usedTools.push({ name: event.tool });
                break;
              case 'text':
                fullText += event.content;
                // Update the assistant message in real-time
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === 'assistant' && last._streaming) {
                    return [...prev.slice(0, -1), { ...last, content: fullText }];
                  }
                  return [...prev, { role: 'assistant', content: fullText, _streaming: true }];
                });
                break;
              case 'done':
                if (event.conversation_id) {
                  setActiveConversationId(event.conversation_id);
                }
                // Finalize the message (remove _streaming flag, add tools)
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === 'assistant') {
                    return [...prev.slice(0, -1), {
                      role: 'assistant',
                      content: last.content,
                      tools_used: usedTools,
                    }];
                  }
                  return prev;
                });
                setToolCalls([]);
                break;
              case 'error':
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `Error: ${event.message}`,
                }]);
                setToolCalls([]);
                break;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      const errMsg = extractErrorMessage(err, 'Failed to reach the AI assistant');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }]);
      setToolCalls([]);
    } finally {
      setLoading(false);
      loadConversations(); // Refresh sidebar
    }
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setToolCalls([]);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.delete(`/api/farms/${farmId}/ai/conversations/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (id === activeConversationId) handleNewChat();
    } catch {
      // Silently fail
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      sx={{
        '& .MuiDrawer-paper': {
          width: CHAT_WIDTH,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: `1px solid ${theme.palette.divider}`,
        },
      }}
    >
      {/* Header */}
      <Box sx={{
        p: 1.5, display: 'flex', alignItems: 'center', gap: 1,
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: alpha(theme.palette.primary.main, 0.04),
      }}>
        <SmartToyIcon color="primary" sx={{ fontSize: 22 }} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
          C2 Assistant
        </Typography>
        <Tooltip title={showHistory ? 'Back to chat' : 'Chat history'}>
          <IconButton size="small" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? <SmartToyIcon sx={{ fontSize: 18 }} /> : (
              <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 500 }}>
                {conversations.length}
              </Typography>
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="New chat">
          <IconButton size="small" onClick={handleNewChat}>
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      {/* Conversation History */}
      {showHistory ? (
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={(id) => loadConversation(id)}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
        />
      ) : (
        <>
          {/* Messages */}
          <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1.5 }}>
            {messages.length === 0 && (
              <Box sx={{ textAlign: 'center', pt: 8, px: 2 }}>
                <SmartToyIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Ask me anything about your operation
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  Inventory, contracts, forecasts, agronomy, settlements, and more
                </Typography>
                <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {[
                    "What's our canola position?",
                    'Any unsettled deliveries?',
                    'How are we tracking against budget?',
                  ].map((q) => (
                    <Chip
                      key={q}
                      label={q}
                      variant="outlined"
                      size="small"
                      onClick={() => { setInput(q); }}
                      sx={{ cursor: 'pointer', fontSize: 12 }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {messages.map((msg, idx) => (
              <MessageBubble
                key={idx}
                message={msg}
                isUser={msg.role === 'user'}
                theme={theme}
              />
            ))}

            {/* Active tool calls */}
            {toolCalls.length > 0 && (
              <Fade in>
                <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
                  {toolCalls.map((tool, idx) => (
                    <ToolCallChip key={idx} toolName={tool} />
                  ))}
                </Box>
              </Fade>
            )}

            {loading && toolCalls.length === 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">Thinking...</Typography>
              </Box>
            )}

            <div ref={messagesEndRef} />
          </Box>

          {/* Input */}
          <Box sx={{ p: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
            <TextField
              inputRef={inputRef}
              fullWidth
              multiline
              maxRows={4}
              size="small"
              placeholder="Ask about your operation..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={sendMessage}
                        disabled={!input.trim() || loading}
                        color="primary"
                      >
                        <SendIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </InputAdornment>
                  ),
                  sx: { fontSize: 14 },
                },
              }}
            />
          </Box>
        </>
      )}
    </Drawer>
  );
}
