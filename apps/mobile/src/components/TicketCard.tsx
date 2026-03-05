import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

interface Props {
  ticket: {
    id: string;
    ticket_number: string;
    delivery_date: string;
    net_weight_mt: number;
    grade: string | null;
    photo_thumbnail_url: string | null;
    commodity: { name: string } | null;
    counterparty: { name: string } | null;
    location: { name: string } | null;
  };
}

export default function TicketCard({ ticket }: Props) {
  const date = new Date(ticket.delivery_date).toLocaleDateString('en-CA');

  return (
    <View style={styles.card}>
      {ticket.photo_thumbnail_url ? (
        <Image source={{ uri: ticket.photo_thumbnail_url }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.noThumb]}>
          <Text style={styles.noThumbText}>No Photo</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.ticketNumber}>#{ticket.ticket_number}</Text>
        <Text style={styles.detail}>{date}</Text>
        <Text style={styles.detail}>
          {ticket.net_weight_mt.toFixed(2)} MT
          {ticket.commodity ? ` - ${ticket.commodity.name}` : ''}
        </Text>
        {ticket.counterparty && (
          <Text style={styles.detail}>{ticket.counterparty.name}</Text>
        )}
        {ticket.grade && <Text style={styles.grade}>{ticket.grade}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: '#eee',
    marginRight: 12,
  },
  noThumb: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noThumbText: {
    fontSize: 9,
    color: '#999',
  },
  info: { flex: 1 },
  ticketNumber: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 2 },
  detail: { fontSize: 13, color: '#666', marginBottom: 1 },
  grade: {
    fontSize: 12,
    color: '#1B5E20',
    fontWeight: '500',
    marginTop: 2,
  },
});
