import * as amqp from 'amqplib';

const rabbitUrl = process.env.RABBIT_URL || '';
let channel: amqp.Channel | null = null;

export async function getChannel(): Promise<amqp.Channel | null> {
  if (!rabbitUrl) return null;
  if (channel) return channel;

  const connection = await amqp.connect(rabbitUrl);
  channel = await connection.createChannel();
  return channel;
}

export async function publishEvent(exchange: string, routingKey: string, payload: unknown) {
  const ch = await getChannel();
  if (!ch) return;
  await ch.assertExchange(exchange, 'topic', { durable: true });
  ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
    contentType: 'application/json'
  });
}
