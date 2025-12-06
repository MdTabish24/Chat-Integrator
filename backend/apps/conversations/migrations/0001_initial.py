# Generated migration for conversations app

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('oauth', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Conversation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('platform_conversation_id', models.CharField(max_length=255)),
                ('participant_name', models.CharField(blank=True, max_length=255, null=True)),
                ('participant_id', models.CharField(blank=True, max_length=255, null=True)),
                ('participant_avatar_url', models.TextField(blank=True, null=True)),
                ('last_message_at', models.DateTimeField(blank=True, null=True)),
                ('unread_count', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('account', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='conversations', to='oauth.connectedaccount')),
            ],
            options={
                'db_table': 'conversations',
                'ordering': ['-last_message_at'],
            },
        ),
        migrations.AddIndex(
            model_name='conversation',
            index=models.Index(fields=['account'], name='conversati_account_idx'),
        ),
        migrations.AddIndex(
            model_name='conversation',
            index=models.Index(fields=['-last_message_at'], name='conversati_last_me_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='conversation',
            unique_together={('account', 'platform_conversation_id')},
        ),
    ]
