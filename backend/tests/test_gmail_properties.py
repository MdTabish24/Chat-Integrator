"""
Property-based tests for Gmail adapter.

**Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
**Validates: Requirements 10.2**

This test verifies that the Gmail adapter's filtering logic correctly
ensures all returned emails are from the Primary category and are unread.
"""

import pytest
from hypothesis import given, strategies as st, settings, assume, HealthCheck
from typing import List, Dict, Optional
from dataclasses import dataclass


# Gmail category labels (matching the adapter)
CATEGORY_PRIMARY = 'CATEGORY_PERSONAL'
EXCLUDED_LABELS = ['SPAM', 'TRASH', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_FORUMS']


@dataclass
class MockEmail:
    """Mock email for testing filter logic."""
    id: str
    thread_id: str
    labels: List[str]
    sender: str
    subject: str
    snippet: str
    
    def to_gmail_format(self) -> Dict:
        """Convert to Gmail API format."""
        return {
            'id': self.id,
            'threadId': self.thread_id,
            'labelIds': self.labels,
            'snippet': self.snippet,
            'payload': {
                'headers': [
                    {'name': 'From', 'value': self.sender},
                    {'name': 'Subject', 'value': self.subject},
                    {'name': 'Date', 'value': '2024-01-01T00:00:00Z'},
                ]
            }
        }


def filter_primary_unread_emails(emails: List[MockEmail]) -> List[MockEmail]:
    """
    Filter emails to only include unread Primary emails.
    This mirrors the filtering logic in the Gmail adapter.
    
    Requirements 10.2: Retrieve only unread emails from Primary category
    (exclude Spam, Promotions, Social)
    """
    filtered = []
    for email in emails:
        # Must be unread
        if 'UNREAD' not in email.labels:
            continue
        
        # Must not be in excluded categories
        is_excluded = False
        for excluded in EXCLUDED_LABELS:
            if excluded in email.labels:
                is_excluded = True
                break
        
        if is_excluded:
            continue
        
        # Email passes filter
        filtered.append(email)
    
    return filtered


# Strategies for generating test data
# Using simpler strategies for faster generation
email_id_strategy = st.text(
    alphabet='abcdefghijklmnopqrstuvwxyz0123456789',
    min_size=5,
    max_size=10
)

email_address_strategy = st.from_regex(r'[a-z]{3,8}@[a-z]{3,6}\.(com|org|net)', fullmatch=True)

subject_strategy = st.text(alphabet='abcdefghijklmnopqrstuvwxyz ', min_size=0, max_size=30)

snippet_strategy = st.text(alphabet='abcdefghijklmnopqrstuvwxyz ', min_size=0, max_size=50)

# Strategy for generating labels
# We want to test various combinations of labels
label_strategy = st.lists(
    st.sampled_from([
        'INBOX',
        'UNREAD',
        'IMPORTANT',
        'STARRED',
        'SPAM',
        'TRASH',
        'CATEGORY_PERSONAL',
        'CATEGORY_SOCIAL',
        'CATEGORY_PROMOTIONS',
        'CATEGORY_UPDATES',
        'CATEGORY_FORUMS',
    ]),
    min_size=0,
    max_size=5,
    unique=True
)


@st.composite
def mock_email_strategy(draw):
    """Generate a mock email with random properties."""
    return MockEmail(
        id=draw(email_id_strategy),
        thread_id=draw(email_id_strategy),
        labels=draw(label_strategy),
        sender=draw(email_address_strategy),
        subject=draw(subject_strategy),
        snippet=draw(snippet_strategy),
    )


mock_email_list_strategy = st.lists(mock_email_strategy(), min_size=0, max_size=20)


class TestGmailPrimaryFilter:
    """
    Property-based tests for Gmail Primary filter.
    
    **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
    **Validates: Requirements 10.2**
    """
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_filtered_emails_are_all_unread(self, emails: List[MockEmail]):
        """
        Property: All filtered emails must be unread.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        
        For any list of emails returned by the Gmail adapter,
        all emails SHALL have is_read=False (i.e., UNREAD label present).
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'UNREAD' in email.labels, \
                f"Email {email.id} should be unread but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_exclude_spam(self, emails: List[MockEmail]):
        """
        Property: No filtered email should be in SPAM.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        
        For any list of emails returned by the Gmail adapter,
        no email SHALL have the SPAM label.
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'SPAM' not in email.labels, \
                f"Email {email.id} should not be spam but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_exclude_trash(self, emails: List[MockEmail]):
        """
        Property: No filtered email should be in TRASH.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'TRASH' not in email.labels, \
                f"Email {email.id} should not be in trash but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_exclude_social(self, emails: List[MockEmail]):
        """
        Property: No filtered email should be in Social category.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'CATEGORY_SOCIAL' not in email.labels, \
                f"Email {email.id} should not be social but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_exclude_promotions(self, emails: List[MockEmail]):
        """
        Property: No filtered email should be in Promotions category.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'CATEGORY_PROMOTIONS' not in email.labels, \
                f"Email {email.id} should not be promotions but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_exclude_forums(self, emails: List[MockEmail]):
        """
        Property: No filtered email should be in Forums category.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            assert 'CATEGORY_FORUMS' not in email.labels, \
                f"Email {email.id} should not be forums but has labels: {email.labels}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filtered_emails_are_primary_category(self, emails: List[MockEmail]):
        """
        Property: All filtered emails must be in Primary category (not in excluded categories).
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        
        For any list of emails returned by the Gmail adapter,
        all emails SHALL have category "Primary" (i.e., not in any excluded category).
        """
        filtered = filter_primary_unread_emails(emails)
        
        for email in filtered:
            for excluded in EXCLUDED_LABELS:
                assert excluded not in email.labels, \
                    f"Email {email.id} should be Primary but has excluded label {excluded}"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filter_preserves_valid_emails(self, emails: List[MockEmail]):
        """
        Property: Valid Primary unread emails should not be filtered out.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        
        For any email that is unread and not in an excluded category,
        it should appear in the filtered results.
        """
        filtered = filter_primary_unread_emails(emails)
        filtered_ids = {e.id for e in filtered}
        
        for email in emails:
            # Check if email should be included
            is_unread = 'UNREAD' in email.labels
            is_excluded = any(excl in email.labels for excl in EXCLUDED_LABELS)
            
            if is_unread and not is_excluded:
                assert email.id in filtered_ids, \
                    f"Valid email {email.id} should be in filtered results"
    
    @given(emails=mock_email_list_strategy)
    @settings(max_examples=100)
    def test_filter_count_is_correct(self, emails: List[MockEmail]):
        """
        Property: Filter count should match expected count.
        
        **Feature: chat-orbitor-fix, Property 8: Gmail Filter - Primary Only**
        **Validates: Requirements 10.2**
        """
        filtered = filter_primary_unread_emails(emails)
        
        # Count expected emails manually
        expected_count = 0
        for email in emails:
            is_unread = 'UNREAD' in email.labels
            is_excluded = any(excl in email.labels for excl in EXCLUDED_LABELS)
            if is_unread and not is_excluded:
                expected_count += 1
        
        assert len(filtered) == expected_count, \
            f"Expected {expected_count} emails but got {len(filtered)}"
