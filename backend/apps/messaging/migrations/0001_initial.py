# Generated migration for messaging app

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('conversations', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Message',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('platform_message_id', models.CharField(max_length=255)),
                ('sender_id', models.CharField(max_length=255)),
                ('sender_name', models.CharField(blank=True, max_length=255, null=True)),
                ('content', models.TextField()),
                ('message_type', models.CharField(choices=[('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('file', 'File')], default='text', max_length=50)),
                ('media_url', models.TextField(blank=True, null=True)),
                ('is_outgoing', models.BooleanField(default=False)),
                ('is_read', models.BooleanField(default=False)),
                ('sent_at', models.DateTimeField()),
                ('delivered_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('conversation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='conversations.conversation')),
            ],
            options={
                'db_table': 'messages',
                'ordering': ['-sent_at'],
            },
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(fields=['conversation'], name='messages_convers_idx'),
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(fields=['-sent_at'], name='messages_sent_at_idx'),
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(condition=models.Q(('is_read', False)), fields=['is_read'], name='idx_messages_unread'),
        ),
        migrations.AlterUniqueTogether(
            name='message',
            unique_together={('conversation', 'platform_message_id')},
        ),
    ]
