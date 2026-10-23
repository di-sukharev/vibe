import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  AttachmentGroup,
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from '@/components/ui/attachment'
import { Spinner } from '@/components/ui/spinner'
import { DemoSurface } from './demo-surface'

const meta = {
  component: AttachmentDemo,
  title: 'UI/Messaging/Attachment',
} satisfies Meta<typeof AttachmentDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

function AttachmentDemo() {
  return (
    <DemoSurface>
      <AttachmentGroup>
        <Attachment>
          <AttachmentMedia>PDF</AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>product-brief.pdf</AttachmentTitle>
            <AttachmentDescription>1.8 MB · ready</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Remove attachment">×</AttachmentAction>
          </AttachmentActions>
        </Attachment>
        <Attachment state="uploading">
          <AttachmentMedia>
            <Spinner />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>research.png</AttachmentTitle>
            <AttachmentDescription>Uploading…</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        <Attachment state="error">
          <AttachmentMedia>!</AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>archive.zip</AttachmentTitle>
            <AttachmentDescription>Upload failed</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      </AttachmentGroup>
    </DemoSurface>
  )
}
