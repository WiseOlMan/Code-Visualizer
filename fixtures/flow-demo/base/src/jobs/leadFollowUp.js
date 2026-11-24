/** Worker for the lead follow-up queue. */
export class LeadFollowUpJob {
  async perform(payload) {
    return prisma.inquiry.findMany({
      where: { id: payload.inquiryId },
      select: { email: true, status: true },
    });
  }

  async unusedSweep() {
    return null;
  }
}
