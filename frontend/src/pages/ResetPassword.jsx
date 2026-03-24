import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Card, CardContent, TextField, Button, Typography, Alert } from '@mui/material';
import api from '../services/api';
import { extractErrorMessage } from '../utils/errorHelpers';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain at least one letter and one number');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/reset-password', { token, password });
      setSuccess(data.message);
    } catch (err) {
      setError(extractErrorMessage(err, 'Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <Card sx={{ width: 400, p: 2 }}>
          <CardContent>
            <Alert severity="error" sx={{ mb: 2 }}>Invalid reset link. No token provided.</Alert>
            <Box sx={{ textAlign: 'center' }}>
              <Typography
                component={Link}
                to="/forgot-password"
                variant="body2"
                sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                Request a new reset link
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      <Card sx={{ width: 400, p: 2 }}>
        <CardContent>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <img src="/logo.png" alt="C2 Farms" style={{ width: 60, height: 'auto', marginBottom: 8 }} />
          </Box>
          <Typography variant="h5" textAlign="center" color="primary" fontWeight={700} gutterBottom>
            Set New Password
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

          {!success ? (
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="New Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                sx={{ mb: 2 }}
                autoFocus
              />
              <TextField
                fullWidth
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                sx={{ mb: 3 }}
              />
              <Button fullWidth variant="contained" type="submit" disabled={loading || !password || !confirmPassword} size="large">
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </form>
          ) : null}

          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography
              component={Link}
              to="/login"
              variant="body2"
              sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {success ? 'Go to login' : 'Back to login'}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
