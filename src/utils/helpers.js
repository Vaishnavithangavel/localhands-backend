const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

const calculateTrustScore = (stats) => {
  const {
    completedTasks = 0,
    averageRating = 0,
    isVerified = false,
    volunteerHours = 0,
    responseRate = 0
  } = stats;

  const taskScore = Math.min(completedTasks / 50, 1) * 40;
  const ratingScore = (averageRating / 5) * 30;
  const verificationScore = isVerified ? 10 : 0;
  const volunteerScore = Math.min(volunteerHours / 100, 1) * 10;
  const responseScore = (responseRate / 100) * 10;

  return Math.round((taskScore + ratingScore + verificationScore + volunteerScore + responseScore) * 100) / 100;
};

const calculateCommission = (amount, percentage = 10) => {
  return Math.round((amount * percentage) / 100 * 100) / 100;
};

const paginate = (page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  return { offset, limit: parseInt(limit) };
};

module.exports = {
  haversineDistance,
  calculateTrustScore,
  calculateCommission,
  paginate
};
