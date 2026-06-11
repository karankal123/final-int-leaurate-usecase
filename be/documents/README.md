# Documents Folder

Place applicant PDF documents here for preview functionality.

## File Naming Convention

Files should match the attachment names in `Applicant_Case_Tracker.xlsx`:

```
be/documents/
├── CAS.pdf                    (for Elizabeth Dorin - 44159902)
├── ariana_docs.pdf            (for Ariana Arvanitis - 45090489)
├── james_docs.pdf             (for James Okafor - 38821044)
├── sofia_docs.pdf             (for Sofia Patel - 52109876)
├── marcus_docs.pdf            (for Marcus Lee - 61234509)
├── priya_docs.pdf             (for Priya Sharma - 70987612)
└── Alexandra G.pdf            (for Alexandra Kennington - 44173071)
```

## How It Works

1. The backend serves files from this folder via `/documents/{filename}` endpoint
2. Frontend attachment chips link to these URLs
3. Clicking a document chip opens the PDF in a modal preview

## Adding New Documents

1. Place the PDF file in this folder
2. Update the `Attachments` column in `Applicant_Case_Tracker.xlsx` with the filename
3. The document will be available for preview in the UI
