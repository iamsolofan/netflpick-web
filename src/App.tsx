import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';

// ========================================
// 1. Firebase 및 초기화 세팅
// ========================================
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, getDoc, setDoc, updateDoc, where, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDVT-rVDkwJAUmtGqpu0JHkpYPn0E4MU2I",
  authDomain: "netflpick.firebaseapp.com",
  projectId: "netflpick",
  storageBucket: "netflpick.firebasestorage.app",
  messagingSenderId: "165746733752",
  appId: "1:165746733752:web:a3215832ba27947e077a4d"
};

let app, auth, db, storage, googleProvider;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app); 
  googleProvider = new GoogleAuthProvider();
} catch (error) {
  console.error("Firebase 초기화 에러:", error);
}

// ==========================================
// 2. TMDB API 및 기본 세팅
// ==========================================
const TMDB_API_KEY = '76443390f2fa65f0847944528266855f'; 
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const getRecentFridayKST = () => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000));
  const day = kst.getDay();
  const diff = (day + 7 - 5) % 7; 
  kst.setDate(kst.getDate() - diff);
  return kst.toISOString().split('T')[0];
};

const CINEMA_HELL_PANELS = ['전체', '신작', '전찬일', '라이너', '거의없다', '기타'];

// ==========================================
// 3. UI 컴포넌트 모음
// ==========================================

const MovieCard = ({ movie, isWorst, onMovieClick }) => (
  <div onClick={() => onMovieClick && onMovieClick(movie)} className="flex flex-col gap-2 transition-transform duration-200 hover:scale-105 cursor-pointer group w-full">
    <div className="relative overflow-hidden rounded-md shadow-lg aspect-[2/3] bg-gray-800 flex items-center justify-center">
      <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover transition-opacity group-hover:opacity-80" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(movie.title)}`; }} />
      {isWorst && <div className="absolute top-2 right-2 bg-black/80 text-red-500 text-xs font-bold px-2 py-1 rounded">워스트</div>}
    </div>
    <h3 className="text-sm font-bold truncate text-white mt-1" title={movie.title}>{movie.title}</h3>
    <div className="flex justify-between items-center text-[10px] sm:text-xs text-gray-400">
      <div className="flex items-center gap-1"><span className="text-yellow-400">★</span><span className="font-semibold text-gray-200">{Number(movie.rating).toFixed(1)}</span></div>
      <div>{isWorst ? <span className="text-red-400">👎 {movie.notRecommends}</span> : <span className="text-green-400">👍 {movie.recommends}</span>}</div>
    </div>
  </div>
);

const Top10Section = ({ title, movies, isWorst = false, onMovieClick }) => {
  const [sortType, setSortType] = useState('rating');
  const sortedMovies = [...movies].sort((a, b) => {
    if (sortType === 'rating') return isWorst ? parseFloat(a.rating) - parseFloat(b.rating) : parseFloat(b.rating) - parseFloat(a.rating);
    return isWorst ? b.notRecommends - a.notRecommends : b.recommends - a.recommends;
  });

  return (
    <section className="mb-12 animate-fadeIn">
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center mb-4 gap-4">
        <h2 className="text-xl md:text-2xl font-bold text-white border-l-4 border-red-600 pl-3">{title}</h2>
        <div className="flex bg-gray-800 rounded-md p-1 border border-gray-700">
          <button onClick={() => setSortType('rating')} className={`px-3 py-1 text-xs md:text-sm rounded-md transition-colors ${sortType === 'rating' ? 'bg-red-600 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}>평점순</button>
          <button onClick={() => setSortType('count')} className={`px-3 py-1 text-xs md:text-sm rounded-md transition-colors ${sortType === 'count' ? 'bg-red-600 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}>{isWorst ? '비추천자순' : '추천자순'}</button>
        </div>
      </div>
      {movies.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-500 border border-gray-800 rounded-lg">아직 등록된 영화가 없습니다. 첫 평점을 남겨주세요!</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          {sortedMovies.slice(0, 10).map((movie, index) => (
            <MovieCard key={`${movie.id}-${index}`} movie={movie} isWorst={isWorst} onMovieClick={onMovieClick} />
          ))}
        </div>
      )}
    </section>
  );
};

const MovieDetailPage = ({ myRatings, onOpenReviewForm }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const movie = location.state?.movie;
  const [reviewMode, setReviewMode] = useState('collapsed'); 
  const [tmdbInfo, setTmdbInfo] = useState(null); 
  const [actualReviews, setActualReviews] = useState([]);

// 시네마지옥 리뷰만 따로 모아보기
// 1. 뱃지 로직을 '다수결' 원칙으로 변경
const cinemaReviews = actualReviews.filter(review => review.isCinema === true || review.isCinema === "true");
let maebulStatus = 'none';

if (cinemaReviews.length > 0) {
  let recCount = 0;
  let nonRecCount = 0;

  cinemaReviews.forEach(review => {
    if (review.isRecommend === true || String(review.isRecommend).toLowerCase() === 'true') recCount++;
    else if (review.isRecommend === false || String(review.isRecommend).toLowerCase() === 'false') nonRecCount++;
  });

  if (recCount > nonRecCount) maebulStatus = 'recommend';
  else if (nonRecCount > recCount) maebulStatus = 'not_recommend';
  else if (recCount === nonRecCount && recCount > 0) maebulStatus = 'mixed'; // 호불호
  else maebulStatus = 'none';
}

useEffect(() => {
  if (!movie) { navigate('/'); return; }
  document.title = `${movie.title} 평점 및 한줄평 모음 - 넷플픽`;
  
  if (movie.id) {
    fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&language=ko-KR&append_to_response=credits`)
      .then(res => res.json())
      .then(data => {
        const director = data.credits?.crew?.find(c => c.job === 'Director')?.name;
        const actors = data.credits?.cast?.slice(0, 3).map(a => a.name).join(', ');
        setTmdbInfo({ ...data, director, actors });
      })
      .catch(err => console.error(err));
  }

  const fetchReviews = async () => {
    if (!db) return;
    try {
      const rSnap = await getDocs(query(collection(db, "ratings"), where("id", "==", movie.id)));
      const cSnap = await getDocs(query(collection(db, "cinema_reviews"), where("id", "==", movie.id)));
      
      const reviews = [];
      rSnap.forEach(doc => reviews.push({ ...doc.data(), isCinema: false }));
      cSnap.forEach(doc => {
        const data = doc.data();
        
        // 🔥 2. 솔직한 리뷰에 패널들을 개별적으로 쪼개서 표시하는 로직
        if (data.panelName === '신작' && data.opinions) {
          data.opinions.forEach((op, index) => {
            if (op.active) {
              reviews.push({
                id: `${doc.id}_${index}`, 
                nickname: op.critic === '기타' ? (op.customName || '기타') : op.critic,
                rating: op.rating || data.rating, 
                isRecommend: op.isRecommend, // null(애매함) 허용
                comment: op.comment || data.comment,
                date: data.broadcastDate, 
                isCinema: true
              });
            }
          });
        } else {
          reviews.push({
            id: doc.id, nickname: data.reviewerName, rating: data.rating, isRecommend: data.isRecommend,
            comment: data.comment, date: data.broadcastDate, isCinema: true
          });
        }
      });
      reviews.sort((a,b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      setActualReviews(reviews);
    } catch(e) { console.error(e); }
  };
  fetchReviews();
}, [movie, navigate]);
  if (!movie) return null;

  const displayReviews = reviewMode === 'collapsed' ? actualReviews.slice(0, 3) : actualReviews;

  return (
    <div className="max-w-2xl mx-auto animate-fadeIn mt-4">

<Helmet>
  {/* 🔥 검색량 폭발 키워드를 전면 배치한 제목 */}
  <title>[넷플픽] {movie.title} 평점 리뷰 - 넷플릭스 영화 추천 및 순위</title>
  
  {/* 🔥 월간 검색량이 높은 알짜 키워드로 문맥을 구성한 설명 */}
  <meta 
    name="description" 
    content={`넷플릭스 추천 영화 '${movie.title}' 평점 및 리뷰! 넷플릭스 영화 추천 명작부터 넷플릭스 순위, 넷플릭스 추천 드라마 시리즈까지 넷플픽에서 한 번에 확인하세요. (화제작 동궁 넷플릭스 최신 리뷰 포함)`} 
  />
  
  {/* 🔥 월간 검색량 최상위 키워드 총집합 */}
  <meta name="keywords" content={`${movie.title}, 넷플릭스 추천, 넷플릭스 영화 추천, 동궁 넷플릭스, 넷플릭스 순위, 넷플릭스 추천 영화, 넷플릭스 추천 드라마, 넷플릭스 영화 순위, 넷플릭스 시리즈 추천`} />
</Helmet>

      <div className="flex flex-col sm:flex-row gap-5 mb-8 bg-gray-800 p-4 md:p-6 rounded-2xl border border-gray-700 shadow-xl">
        <img src={movie.poster} alt={movie.title} className="w-32 md:w-40 h-auto object-cover rounded-xl shadow-lg shrink-0 mx-auto sm:mx-0" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(movie.title)}`; }} />
        <div className="flex flex-col justify-center flex-1 text-center sm:text-left">
        <h2 className="text-xl md:text-2xl font-extrabold text-white mb-2 flex items-center">
  {movie.title}
  {maebulStatus === 'recommend' && <span className="ml-3 text-sm font-normal bg-green-600 text-white px-3 py-1 rounded-full">🔥 매불쇼 추천</span>}
  {maebulStatus === 'not_recommend' && <span className="ml-3 text-sm font-normal bg-red-600 text-white px-3 py-1 rounded-full">💣 매불쇼 비추천</span>}
  {maebulStatus === 'mixed' && <span className="ml-3 text-sm font-normal bg-yellow-500 text-black px-3 py-1 rounded-full">🤔 매불쇼 호불호</span>}
</h2>
          <div className="text-yellow-400 font-extrabold text-xl mb-3">★ {Number(movie.rating).toFixed(1)} <span className="text-gray-500 text-sm font-normal">/ 10</span></div>
          
          <div className="flex justify-center sm:justify-start gap-2 text-xs font-bold mb-4">
            <span className="text-green-400 bg-green-900/30 px-3 py-1 rounded-full border border-green-800">👍 {movie.recommends || 0}명</span>
            <span className="text-red-400 bg-red-900/30 px-3 py-1 rounded-full border border-red-800">👎 {movie.notRecommends || 0}명</span>
          </div>

          {tmdbInfo && tmdbInfo.overview && (
            <div className="text-left bg-gray-900/60 p-3 rounded-lg border border-gray-700 mb-4 text-xs">
              <p className="text-gray-300 mb-1"><span className="font-bold text-gray-400">개봉:</span> {tmdbInfo.release_date}</p>
              <p className="text-gray-300 mb-1"><span className="font-bold text-gray-400">장르:</span> {tmdbInfo.genres?.map(g => g.name).join(', ')}</p>
              <p className="text-gray-300 mb-1"><span className="font-bold text-gray-400">감독:</span> {tmdbInfo.director || '정보 없음'}</p>
              <p className="text-gray-300 mb-2"><span className="font-bold text-gray-400">출연:</span> {tmdbInfo.actors || '정보 없음'}</p>
              <p className="text-gray-400 line-clamp-3 leading-relaxed mt-2 pt-2 border-t border-gray-700">{tmdbInfo.overview}</p>
            </div>
          )}

          <button onClick={() => onOpenReviewForm(movie)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl shadow-lg transition-all text-sm w-full">
            ✏️ 나도 이 영화 평점 남기기
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-2xl p-4 md:p-6 border border-gray-700 shadow-xl mb-12 text-left">
        <h3 className="text-lg md:text-xl font-bold text-white mb-4 border-l-4 border-red-600 pl-3">솔직한 리뷰 ({actualReviews.length}건)</h3>
        {actualReviews.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">아직 작성된 리뷰가 없습니다. 첫 리뷰의 주인공이 되어보세요!</p>
        ) : (
          <div className="flex flex-col gap-3 mb-5">
            {displayReviews.map((review, i) => (
              <div key={review.id || i} className="bg-gray-900 p-3.5 rounded-xl border border-gray-700 hover:border-gray-500 transition-colors">
                 <div className="flex justify-between items-center mb-1.5">
                   <div className="flex items-center gap-2">
                     {review.isCinema && <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">매불쇼</span>}
                     <span className="text-white font-bold text-xs">{review.nickname}</span>
                     
                     {/* 🚨 양방향 추천 표시 로직 */}
                     {review.isRecommend === 'both' ? (
                       <div className="flex gap-1">
                         <span className="text-green-400 text-[10px] border border-green-500 px-1.5 py-0.5 rounded bg-green-900/20">추천</span>
                         <span className="text-red-400 text-[10px] border border-red-500 px-1.5 py-0.5 rounded bg-red-900/20">비추천</span>
                       </div>
                     ) : review.isRecommend ? (
                       <span className="text-green-400 text-[10px] border border-green-500 px-1.5 py-0.5 rounded bg-green-900/20">추천</span>
                     ) : (
                       <span className="text-red-400 text-[10px] border border-red-500 px-1.5 py-0.5 rounded bg-red-900/20">비추천</span>
                     )}
                   </div>
                   <span className="text-yellow-400 font-bold text-sm">★ {Number(review.rating).toFixed(1)}</span>
                 </div>
                 <p className="text-gray-300 text-xs leading-relaxed">"{review.comment}"</p>
                 <div className="text-gray-600 text-[10px] text-right mt-1">{review.date ? new Date(review.date).toLocaleDateString('ko-KR') : ''}</div>
              </div>
            ))}
          </div>
        )}
        
        <div className="flex gap-3">
          {reviewMode === 'collapsed' && actualReviews.length > 3 && (
            <button onClick={() => setReviewMode('expanded')} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-bold text-xs rounded-xl transition-colors border border-gray-600">
              더 많은 리뷰 보기 ▼
            </button>
          )}
          {reviewMode === 'expanded' && (
            <button onClick={() => setReviewMode('collapsed')} className="flex-1 py-2.5 bg-gray-900 hover:bg-black text-gray-400 font-bold text-xs rounded-xl transition-colors border border-gray-700">
              솔직한 영화평 접기 ▲
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const LatestReviewsSection = ({ latestReviews, onMovieClick }) => (
  <section className="animate-fadeIn">
    <div className="mb-12 bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl">
      <h2 className="text-xl font-bold text-white mb-6 border-l-4 border-red-600 pl-3">🔥 실시간 최신 평가</h2>
      {latestReviews && latestReviews.length > 0 ? (
        <div className="flex flex-col gap-6">
          {latestReviews.map((review, idx) => (
            <div key={idx} className="flex gap-6 items-center border-b border-gray-700 pb-6 last:border-0 last:pb-0 relative mt-2">
              
              <img src={review.poster} onClick={() => onMovieClick(review)} alt="" className="w-20 h-28 object-cover rounded shadow-md bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity shrink-0" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(review.title)}`; }} />
              <div className="flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
                  <h3 className="text-lg font-bold text-white cursor-pointer hover:text-red-400 transition-colors" onClick={() => onMovieClick(review)}>{review.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 text-sm font-bold">★ {Number(review.rating).toFixed(1)}</span>
                  </div>
                </div>

                {/* 🔥 닉네임, 날짜, 추천 여부를 제목 바로 아래로 이동 */}
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                  <span className="font-bold text-gray-300">
                    {review.panelName === '신작' ? '🎬 신작 소개작' : (review.reviewerName || review.nickname || '익명')}
                  </span>
                  <span className="text-gray-600">|</span>
                  <span>{review.date ? new Date(review.date).toLocaleDateString('ko-KR') : ''}</span>
                  
                  {/* 신작이 아닌 경우에만 추천/비추천 여부 표시 */}
                  {review.panelName !== '신작' && (
                    <>
                      <span className="text-gray-600">|</span>
                      <span className={`font-bold ${review.isRecommend === 'both' ? 'text-yellow-400' : (review.isRecommend ? 'text-green-400' : 'text-red-400')}`}>
                        {review.isRecommend === 'both' ? '🤔 호불호' : (review.isRecommend ? '👍 추천' : '👎 비추천')}
                      </span>
                    </>
                  )}
                </div>

                {/* 🔥 신작 패널별 의견 쫙 뿌려주는 영역 */}
                {review.panelName === '신작' && review.opinions && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {review.opinions.filter(op => op.active).map((op, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold border ${op.isRecommend ? 'bg-green-900/40 text-green-400 border-green-700' : 'bg-red-900/40 text-red-400 border-red-700'}`}>
                        {op.critic === '기타' ? op.customName : op.critic} {op.isRecommend ? '👍' : '👎'}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-gray-300 text-sm bg-gray-900 p-3 rounded border border-gray-700">"{review.comment}"</p>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-gray-500 text-center py-10">등록된 리뷰가 없습니다.</p>}
    </div>
  </section>
);

const MyTasteSection = ({ myRatings, allRatings, allCinemaReviews, onMovieClick }) => {
  const [expandedUserId, setExpandedUserId] = useState(null);

  const matchingUsers = useMemo(() => {
    if (!myRatings || myRatings.length === 0) return [];

    const profiles = {}; 
    const myRatingsMap = new Map();
    
    // 나의 평점 정보를 쉽게 찾기 위해 Map으로 정리
    myRatings.forEach(r => myRatingsMap.set(r.id, r));
    const myRatedIds = new Set(myRatingsMap.keys());
    
    // 일반 유저 프로필 수집
    allRatings.forEach(r => {
      if (r.uid === myRatings[0].uid) return; 
      if (!profiles[r.uid]) profiles[r.uid] = { id: r.uid, name: r.nickname, avatar: '👤', likes: [], dislikes: [], ratedIds: new Set() };
      profiles[r.uid].ratedIds.add(r.id);
      
      if (r.isRecommend === 'both') {
         profiles[r.uid].likes.push(r);
         profiles[r.uid].dislikes.push(r);
      } else if (r.isRecommend) profiles[r.uid].likes.push(r);
      else profiles[r.uid].dislikes.push(r);
    });

    // 패널(평론가/배우 등) 프로필 수집
    allCinemaReviews.forEach(r => {
      const criticId = `critic_${r.reviewerName}`;
      
      const role = r.reviewerJob || '평론가';
      
      if (!profiles[criticId]) profiles[criticId] = { id: criticId, name: `${r.reviewerName} (${role})`, avatar: '🎬', likes: [], dislikes: [], ratedIds: new Set() };
      profiles[criticId].ratedIds.add(r.id);
      
      if (r.isRecommend === 'both') {
         profiles[criticId].likes.push(r);
         profiles[criticId].dislikes.push(r);
      } else if (r.isRecommend) profiles[criticId].likes.push(r);
      else profiles[criticId].dislikes.push(r);
    });

    const results = [];

    Object.values(profiles).forEach(profile => {
       const commonIds = [...profile.ratedIds].filter(id => myRatedIds.has(id));
       if (commonIds.length === 0) return; 

       let agreements = 0;
       const commonLikes = [];
       const commonDislikes = [];
       const commonDisagreements = []; 

       commonIds.forEach(id => {
          const myR = myRatingsMap.get(id);
          const myVote = myR.isRecommend === 'both' ? '🤔' : (myR.isRecommend ? '👍' : '👎');
          
          const theirR = profile.likes.find(m => m.id === id) || profile.dislikes.find(m => m.id === id);
          const theirVote = theirR.isRecommend === 'both' ? '🤔' : (theirR.isRecommend ? '👍' : '👎');

          const movieInfo = {
              id: id, title: theirR.title, poster: theirR.poster,
              myVote: myVote, myRating: myR.rating || 0,
              theirVote: theirVote, theirRating: theirR.rating || 0
          };

          const iLiked = myR.isRecommend === true || myR.isRecommend === 'both';
          const iDisliked = myR.isRecommend === false || myR.isRecommend === 'both';
          const theyLiked = profile.likes.some(m => m.id === id);
          const theyDisliked = profile.dislikes.some(m => m.id === id);

          if (iLiked && theyLiked) {
             agreements++;
             commonLikes.push(movieInfo);
          } else if (iDisliked && theyDisliked) {
             agreements++;
             commonDislikes.push(movieInfo);
          } else {
             // 평가가 엇갈린 경우
             commonDisagreements.push(movieInfo);
          }
       });

       const matchRate = Math.round((agreements / commonIds.length) * 100);
       
       if (agreements > 0 || commonDisagreements.length > 0) {
         results.push({
           ...profile,
           matchRate,
           commonCount: commonIds.length,
           agreements,
           commonLikes,
           commonDislikes,
           commonDisagreements
         });
       }
    });

    return results.sort((a, b) => {
       if (b.matchRate !== a.matchRate) return b.matchRate - a.matchRate;
       return b.commonCount - a.commonCount;
    }).slice(0, 5);

  }, [myRatings, allRatings, allCinemaReviews]);

  // 🎬 영화 리스트 렌더링 헬퍼 함수 (디자인 수정 반영)
  const renderMovieList = (movies) => (
      <div className="flex flex-col gap-3">
          {movies.map((m, i) => (
              <div key={i} className="flex items-center gap-4 bg-gray-900 p-3 rounded-lg border border-gray-700 cursor-pointer hover:border-gray-500 transition-colors" onClick={(e) => { e.stopPropagation(); onMovieClick(m); }}>
                  {/* 🔥 포스터 크기 키움 (w-12 h-16 -> w-14 h-20) */}
                  <img src={m.poster} alt={m.title} className="w-14 h-20 object-cover rounded shadow-md shrink-0" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(m.title)}`; }} />
                  <div className="flex flex-col flex-1 overflow-hidden">
                      {/* 🔥 영화 제목 폰트 키움 (text-sm -> text-base) */}
                      <span className="text-white font-bold text-base mb-1.5 truncate">{m.title}</span>
                      <div className="text-xs text-gray-400 bg-gray-800 p-2 rounded inline-block w-fit border border-gray-700">
                          <span className="font-semibold text-gray-200">나:</span> {m.myVote} ({Number(m.myRating).toFixed(1)}점)
                          <span className="mx-2 text-gray-600">|</span>
                          <span className="font-semibold text-gray-200">상대:</span> {m.theirVote} ({Number(m.theirRating).toFixed(1)}점)
                      </div>
                  </div>
              </div>
          ))}
      </div>
  );

  return (
    <section className="animate-fadeIn">
      <div className="text-center mb-10"><h2 className="text-3xl font-extrabold text-white mb-2">🤝 나와 <span className="text-red-500">취향이 맞는</span> 유저 Top 5</h2></div>
      
      {matchingUsers.length === 0 ? (
        <div className="bg-gray-800 p-10 rounded-xl text-center border border-gray-700">
          <p className="text-gray-400 mb-2">아직 겹치는 평가를 남긴 유저나 평론가가 없습니다.</p>
          <p className="text-gray-500 text-sm">더 훨씬 많은 영화에 평점을 남겨 취향이 맞는 사람을 찾아보세요!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {matchingUsers.map((user, idx) => {
            const isExpanded = expandedUserId === user.id;
            return (
              <div key={user.id} className={`bg-gray-800 border transition-all rounded-xl p-6 relative shadow-lg ${isExpanded ? 'border-red-500' : 'border-gray-700'}`}>
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedUserId(isExpanded ? null : user.id)}>
                  <div className="flex items-center gap-4">
                    <span className="bg-red-600 text-white font-bold px-3 py-1 rounded-lg text-sm shrink-0">{idx + 1}위</span>
                    <span className="text-3xl hidden sm:inline">{user.avatar}</span>
                    <div>
                       <h3 className="text-lg font-bold text-white">{user.name}</h3>
                       {/* 💡 기존에 있던 (일치/총) 텍스트를 여기서 지우고 오른쪽으로 옮겼습니다 */}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                     <div className="text-red-400 font-extrabold text-xl">일치율 {user.matchRate}%</div>
                     {/* 🔥 일치 편수 텍스트 위치 이동 & 크기, 밝기, 굵기 상향 */}
                     <div className="text-gray-300 font-bold text-sm mt-1">(일치 {user.agreements}편 / 총 {user.commonCount}편)</div>
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="mt-6 pt-6 border-t border-gray-700 flex flex-col gap-6">
                    
                    {user.commonLikes.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-300 mb-3 text-center"><span className="text-green-400">👍</span> 통했네 통했어! 같이 추천한 영화</h4>
                        {renderMovieList(user.commonLikes)}
                      </div>
                    )}
                    
                    {user.commonDislikes.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-300 mb-3 text-center"><span className="text-red-400">👎</span> 같이 비추천한 영화</h4>
                        {renderMovieList(user.commonDislikes)}
                      </div>
                    )}

                    {user.commonDisagreements.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-300 mb-3 text-center"><span className="text-yellow-400">🔀</span> 서로 의견이 엇갈린 영화</h4>
                        {renderMovieList(user.commonDisagreements)}
                      </div>
                    )}

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const MyRatingsSection = ({ myRatingsData, onMovieClick, onDeleteRating, onEditRating }) => {
  const [sortType, setSortType] = useState('date');
  const sortedRatings = [...myRatingsData].sort((a, b) => {
    if (sortType === 'date') {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return (isNaN(dateB) ? 0 : dateB) - (isNaN(dateA) ? 0 : dateA);
    }
    return b.rating - a.rating;
  });

  return (
    <section className="animate-fadeIn">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white">⭐ 나의 <span className="text-red-500">평점</span> 기록</h2>
        <div className="flex bg-gray-800 rounded-md p-1 border border-gray-700">
          <button onClick={() => setSortType('date')} className={`px-4 py-2 text-sm rounded-md ${sortType === 'date' ? 'bg-red-600 text-white' : 'text-gray-400'}`}>최신순</button>
          <button onClick={() => setSortType('rating')} className={`px-4 py-2 text-sm rounded-md ${sortType === 'rating' ? 'bg-red-600 text-white' : 'text-gray-400'}`}>평점순</button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {sortedRatings.map((item, idx) => (
          <div key={idx} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex gap-6 items-center relative pr-32">
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              <button onClick={(e) => { e.stopPropagation(); onEditRating(item); }} className="bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 text-xs px-3 py-1.5 rounded transition-colors font-bold">
                수정
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDeleteRating(item.docId); }} className="bg-red-900/60 hover:bg-red-600 text-red-100 hover:text-white border border-red-800 text-xs px-3 py-1.5 rounded transition-colors font-bold">
                삭제
              </button>
            </div>
            <img src={item.poster} onClick={() => onMovieClick(item)} alt={item.title} className="w-20 h-28 object-cover rounded shadow-md bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(item.title)}`; }} />
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1 mt-6 sm:mt-0">
                <h3 className="text-xl font-bold text-white cursor-pointer hover:text-red-400 transition-colors" onClick={() => onMovieClick(item)}>{item.title}</h3>
                
                {/* 🚨 양방향 추천 표시 로직 */}
                {item.isRecommend === 'both' ? (
                  <div className="flex gap-1">
                    <span className="text-green-400 text-[10px] border border-green-400 px-2 py-0.5 rounded w-max">👍 추천</span>
                    <span className="text-red-400 text-[10px] border border-red-400 px-2 py-0.5 rounded w-max">👎 비추천</span>
                  </div>
                ) : item.isRecommend ? (
                  <span className="text-green-400 text-[10px] border border-green-400 px-2 py-0.5 rounded w-max">👍 추천</span>
                ) : (
                  <span className="text-red-400 text-[10px] border border-red-400 px-2 py-0.5 rounded w-max">👎 비추천</span>
                )}
                
              </div>
              <div className="text-yellow-400 font-bold mb-1">★ {Number(item.rating).toFixed(1)}</div>
              <div className="text-gray-500 text-xs mb-2">등록일: {item.date ? new Date(item.date).toLocaleDateString('ko-KR') : '날짜 없음'}</div>
              <p className="text-gray-300 text-sm">"{item.comment}"</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const BoardListPage = ({ user, onLoginRequired }) => {
  const { type } = useParams();
  const [posts, setPosts] = useState([]);
  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);

  const boardName = type === 'qna' ? '질문 답변 게시판' : '전체 자유게시판';

  useEffect(() => {
    document.title = `${boardName} - 넷플픽`;
    const fetchPosts = async () => {
      if (!db) return;
      try {
        const q = query(collection(db, "posts"), where("type", "==", type), orderBy("date", "desc"));
        const snap = await getDocs(q);
        const fetched = [];
        snap.forEach(doc => fetched.push({ id: doc.id, ...doc.data() }));
        setPosts(fetched);
      } catch (e) {
        console.error("게시글 로딩 실패:", e);
      }
    };
    fetchPosts();
  }, [type]);

  const handleWriteClick = () => {
    if (!user) onLoginRequired();
    else setIsWriteModalOpen(true);
  };

  const notices = posts.filter(p => p.isNotice);
  const regularPosts = posts.filter(p => !p.isNotice);

  return (
    <div className="max-w-5xl mx-auto animate-fadeIn mt-4">
      <div className="flex justify-between items-end mb-8 border-b border-gray-700 pb-4">
        <div>
          <h2 className="text-3xl font-extrabold text-white mb-2">{boardName}</h2>
          <p className="text-gray-400">넷플픽 회원들과 자유롭게 이야기를 나누세요.</p>
        </div>
        <button onClick={handleWriteClick} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors shadow-lg">
          ✍️ 글쓰기
        </button>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {posts.length === 0 ? (
          <div className="p-10 text-center text-gray-500">등록된 게시글이 없습니다. 첫 글을 작성해보세요!</div>
        ) : (
          <div className="flex flex-col">
            {notices.map(post => (
              <Link to={`/board/${type}/${post.id}`} state={{ post }} key={post.id} className="p-5 border-b border-gray-700 bg-red-900/20 hover:bg-red-900/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1 overflow-hidden flex items-center gap-3">
                  <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shrink-0">공지</span>
                  <div>
                    <h3 className="text-lg font-bold text-red-100 mb-1 truncate">{post.title}</h3>
                    <div className="text-sm text-gray-400 flex items-center gap-3">
                      <span className="font-semibold text-gray-300">{post.nickname}</span>
                      <span>{new Date(post.date).toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {regularPosts.map(post => (
              <Link to={`/board/${type}/${post.id}`} state={{ post }} key={post.id} className="p-5 border-b border-gray-700 hover:bg-gray-700 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-lg font-bold text-white mb-1 truncate">
                    {post.title}
                    {post.imageUrl && <span className="ml-2 text-xs text-gray-400">🖼️</span>}
                  </h3>
                  <div className="text-sm text-gray-400 flex items-center gap-3">
                    <span className="font-semibold text-gray-300">{post.nickname}</span>
                    <span>{new Date(post.date).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400 shrink-0">
                  <span className="flex items-center gap-1 text-green-400">👍 {post.likes || 0}</span>
                  <span className="flex items-center gap-1 text-red-400">👎 {post.dislikes || 0}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <BoardWriteModal isOpen={isWriteModalOpen} onClose={() => setIsWriteModalOpen(false)} user={user} type={type} onPostAdded={(newPost) => setPosts([newPost, ...posts])} />
    </div>
  );
};

const BoardDetailPage = ({ user, onLoginRequired }) => {
  const { type, postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [post, setPost] = useState(location.state?.post || null);

  useEffect(() => {
    if (!post && db) {
      const fetchPost = async () => {
        const docSnap = await getDoc(doc(db, "posts", postId));
        if (docSnap.exists()) setPost({ id: docSnap.id, ...docSnap.data() });
        else navigate(`/board/${type}`);
      };
      fetchPost();
    }
  }, [postId, post, db, navigate, type]);

  const handleVote = async (voteType) => {
    if (!user) return onLoginRequired();
    if (!db) return;

    try {
      const postRef = doc(db, "posts", postId);
      const postSnap = await getDoc(postRef);
      if (postSnap.exists()) {
        const data = postSnap.data();
        const votedUsers = data.votedUsers || [];
        
        if (votedUsers.includes(user.uid)) return alert("이미 투표하셨습니다.");

        const newLikes = voteType === 'like' ? (data.likes || 0) + 1 : (data.likes || 0);
        const newDislikes = voteType === 'dislike' ? (data.dislikes || 0) + 1 : (data.dislikes || 0);
        
        await updateDoc(postRef, {
          likes: newLikes, dislikes: newDislikes, votedUsers: [...votedUsers, user.uid]
        });

        setPost(prev => ({ ...prev, likes: newLikes, dislikes: newDislikes, votedUsers: [...votedUsers, user.uid] }));
      }
    } catch (e) {
      console.error("투표 오류:", e);
    }
  };

  if (!post) return <div className="text-center py-20 text-gray-500">글을 불러오는 중입니다...</div>;

  return (
    <div className="max-w-4xl mx-auto animate-fadeIn mt-4">

      <Helmet>
        <title>{post.title} - 넷플픽 자유게시판</title>
        <meta name="description" content={post.content.substring(0, 80) + '...'} />
      </Helmet> 

      <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mb-6 flex items-center gap-2">
        ◀ 목록으로 돌아가기
      </button>

      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8 shadow-xl mb-8">
        <div className="flex gap-3 items-center mb-6">
          {post.isNotice && <span className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded">공지</span>}
          <h1 className="text-3xl font-extrabold text-white leading-tight">{post.title}</h1>
        </div>
        
        <div className="flex justify-between items-center border-b border-gray-700 pb-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-xl">👤</div>
            <div>
              <div className="font-bold text-gray-200">{post.nickname}</div>
              <div className="text-xs text-gray-500">{new Date(post.date).toLocaleString('ko-KR')}</div>
            </div>
          </div>
        </div>

        <div className="text-gray-200 text-lg leading-relaxed whitespace-pre-wrap mb-12 min-h-[200px]">
          {post.content}
          {post.imageUrl && (
            <img src={post.imageUrl} alt="첨부 이미지" className="mt-8 max-w-full rounded-lg border border-gray-700" />
          )}
        </div>

        <div className="flex justify-center gap-6 border-t border-gray-700 pt-8">
          <button onClick={() => handleVote('like')} className="flex flex-col items-center gap-2 text-gray-400 hover:text-green-400 transition-colors group">
            <div className="w-16 h-16 rounded-full border-2 border-gray-600 group-hover:border-green-400 flex items-center justify-center text-2xl bg-gray-900 shadow-lg">👍</div>
            <span className="font-bold">추천 {post.likes || 0}</span>
          </button>
          <button onClick={() => handleVote('dislike')} className="flex flex-col items-center gap-2 text-gray-400 hover:text-red-400 transition-colors group">
            <div className="w-16 h-16 rounded-full border-2 border-gray-600 group-hover:border-red-400 flex items-center justify-center text-2xl bg-gray-900 shadow-lg">👎</div>
            <span className="font-bold">비추천 {post.dislikes || 0}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const BoardWriteModal = ({ isOpen, onClose, user, type, onPostAdded }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isNotice, setIsNotice] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const isAdmin = user?.nickname === '넷플픽';

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return alert("제목과 내용을 모두 입력해주세요.");
    setIsUploading(true);
    
    let imageUrl = '';
    try {
      if (imageFile && storage) {
        const imageRef = ref(storage, `board_images/${Date.now()}_${imageFile.name}`);
        await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(imageRef);
      }

      const newPost = {
        uid: user.uid, nickname: user.nickname, type: type, title: title, content: content,
        date: new Date().toISOString(), isNotice: isAdmin && isNotice, imageUrl: imageUrl,
        likes: 0, dislikes: 0, votedUsers: []
      };

      if (db) {
        const docRef = await addDoc(collection(db, "posts"), newPost);
        onPostAdded({ id: docRef.id, ...newPost });
      }
      
      setTitle(''); setContent(''); setImageFile(null); setIsNotice(false);
      onClose();
    } catch (e) { 
      console.error(e);
      alert("글 등록에 실패했습니다."); 
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl p-6 text-white shadow-2xl flex flex-col h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6 shrink-0">
          <h2 className="text-2xl font-bold">새 글 작성</h2>
          <button onClick={onClose} className="text-gray-400 text-3xl font-bold hover:text-white">&times;</button>
        </div>
        
        {isAdmin && (
          <div className="mb-4 flex items-center gap-2">
            <input type="checkbox" id="isNotice" checked={isNotice} onChange={e => setIsNotice(e.target.checked)} className="w-4 h-4 cursor-pointer" />
            <label htmlFor="isNotice" className="text-red-400 font-bold cursor-pointer">공지사항으로 등록</label>
          </div>
        )}

        <input type="text" placeholder="제목을 입력하세요." value={title} onChange={e => setTitle(e.target.value)} className="w-full p-4 bg-gray-800 rounded-lg mb-4 text-white border border-gray-700 outline-none focus:border-red-500 shrink-0 font-bold" />
        <textarea placeholder="내용을 자유롭게 작성해주세요." value={content} onChange={e => setContent(e.target.value)} className="w-full p-4 bg-gray-800 rounded-lg text-white resize-none flex-1 border border-gray-700 outline-none focus:border-red-500 leading-relaxed mb-4" />
        
        <div className="mb-4 shrink-0 bg-gray-800 p-3 rounded-lg border border-gray-700 flex items-center gap-3">
          <span className="text-gray-400 font-bold text-sm">📷 이미지 첨부</span>
          <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files[0])} className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600 cursor-pointer outline-none" />
        </div>

        <div className="flex gap-4 mt-2 shrink-0">
          <button onClick={onClose} disabled={isUploading} className="flex-1 bg-gray-700 py-4 font-bold rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50">취소</button>
          <button onClick={handleSubmit} disabled={isUploading} className="flex-1 bg-red-600 py-4 font-bold rounded-lg shadow-lg hover:bg-red-700 transition-colors disabled:opacity-50">
            {isUploading ? '업로드 중...' : '등록하기'}
          </button>
        </div>
      </div>
    </div>
  );
};


const LoginRequiredMessage = ({ onLoginClick }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn border border-gray-700 rounded-xl bg-gray-800 shadow-xl">
    <span className="text-6xl mb-4">🔒</span>
    <h2 className="text-2xl font-bold text-white mb-2">로그인이 필요한 서비스입니다</h2>
    <p className="text-gray-400 mb-6">넷플픽에 로그인하고 전체 기능을 이용해보세요.</p>
    <button onClick={onLoginClick} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-md transition-colors">로그인 하기</button>
  </div>
);

const NicknameModal = ({ isOpen, onSubmit, onCancel }) => {
  const [nickname, setNickname] = useState('');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex justify-center items-center z-[90] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-6 text-center">
        <h2 className="text-2xl font-bold text-white mb-2">환영합니다! 🎉</h2>
        <p className="text-gray-400 text-sm mb-6">넷플픽에서 사용할 멋진 닉네임을 설정해주세요.</p>
        <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임 입력 (예: 시네마마스터)" className="w-full p-3 bg-gray-800 text-white rounded-md border border-gray-700 focus:border-red-500 focus:outline-none mb-4" />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 bg-gray-700 text-white font-bold py-3 rounded-md hover:bg-gray-600">취소</button>
          <button onClick={() => onSubmit(nickname)} className="flex-1 bg-red-600 text-white font-bold py-3 rounded-md hover:bg-red-700">시작하기</button>
        </div>
      </div>
    </div>
  );
};

const LoginModal = ({ isOpen, onClose }) => {
  // 1. 구글, 카카오, 네이버 초기화 세팅을 한 번에 모아두기
  useEffect(() => {
    // 🚨 핵심 에러 해결: 모달이 안 열렸을 땐 네이버가 버튼 상자를 찾지 않도록 막음!
    if (!isOpen) return;

    // 카카오 초기화 (원본 유지)
    const kakao = (window as any).Kakao;
    if (kakao && !kakao.isInitialized()) {
      kakao.init(import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY);
    }

    // 네이버 초기화 (새로 추가)
    const naverContainer = document.getElementById('naverIdLogin');
    if (window.naver && naverContainer && !naverContainer.hasChildNodes()) {
      const naverLogin = new window.naver.LoginWithNaverId({
        clientId: "eWsbpfhlXDRgHcD3dVwI", // 🚨 진짜 ID 다시 넣는 거 잊지 마!
        callbackUrl: "https://netflpick.com", // ✅ 실제 도메인 주소
        isPopup: true,
        loginButton: { color: "green", type: 1, height: 48 }
      });
      naverLogin.init();

      naverLogin.getLoginStatus(async function (status: boolean) {
        if (status) {
          const naverId = naverLogin.user.getId();
          const naverEmail = naverLogin.user.getEmail() || `naver_${naverId}@netflpick.com`;
          const naverPassword = `netflpick_naver_${naverId}!@`;
          try {
            const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth');
            try {
              await signInWithEmailAndPassword(auth, naverEmail, naverPassword);
            } catch (error) {
              await createUserWithEmailAndPassword(auth, naverEmail, naverPassword);
            }
            onClose();
          } catch (err) {
            console.error("네이버 연동 에러:", err);
          }
        }
      });
    }
  }, [isOpen, onClose]); // 🚨 모달이 열릴 때만 작동하도록 isOpen 추가

  if (!isOpen) return null;

  // 2. 구글 로그인 로직 (원본 완벽 유지)
  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); onClose(); }
    catch (error) { alert("로그인 중 오류가 발생했습니다."); }
  };

  // 3. 카카오 로그인 로직 (원본 완벽 유지)
  const handleKakaoLogin = () => {
    const kakao = (window as any).Kakao;
    if (!kakao) return alert("카카오 통신 객체를 찾을 수 없습니다.");

    kakao.Auth.login({
      success: function (authObj: any) {
        kakao.API.request({
          url: '/v2/user/me',
          success: async function (res: any) {
            const kakaoId = res.id;
            const kakaoEmail = res.kakao_account?.email || `kakao_${kakaoId}@netflpick.com`;
            const kakaoPassword = `netflpick_kakao_${kakaoId}!@`;
            try {
              const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth');
              try {
                await signInWithEmailAndPassword(auth, kakaoEmail, kakaoPassword);
              } catch (error) {
                await createUserWithEmailAndPassword(auth, kakaoEmail, kakaoPassword);
              }
              onClose();
            } catch (err) {
              alert("파이어베이스 로그인 처리 중 에러가 발생했습니다.");
              console.error(err);
            }
          },
          fail: function (error: any) {
            alert("카카오 사용자 정보를 가져오지 못했습니다.");
          }
        });
      },
      fail: function (err: any) {
        alert("카카오 로그인을 취소하셨거나 에러가 발생했습니다.");
      }
    });
  };

  // 4. 네이버 로그인 클릭 트리거
  const handleNaverLoginClick = () => {
    const naverLoginButton = document.getElementById("naverIdLogin")?.firstChild as HTMLElement;
    if (naverLoginButton) naverLoginButton.click();
  };

  // 5. 화면 UI
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-2">NETFL<span className="text-red-600">PICK</span> 로그인</h2>
        <p className="text-gray-400 text-sm mb-6">기기를 변경해도 평점과 글이 영구 보관됩니다.</p>
        
        <button onClick={handleGoogleLogin} className="w-full bg-white text-gray-800 font-bold py-3 rounded-md shadow-lg mb-3 hover:bg-gray-100 transition-colors">
          G Google로 시작하기
        </button>

        <button onClick={handleKakaoLogin} className="w-full bg-[#FEE500] text-black font-bold py-3 rounded-md shadow-lg mb-3 hover:bg-[#FDD800] transition-colors">
          K 카카오로 1초 만에 시작하기
        </button>

        <button onClick={handleNaverLoginClick} className="w-full bg-[#03C75A] text-white font-bold py-3 rounded-md shadow-lg hover:bg-[#02b350] transition-colors">
          N 네이버로 1초 만에 시작하기
        </button>

        {/* 숨겨진 진짜 네이버 버튼 */}
        <div id="naverIdLogin" className="hidden"></div>

        <button onClick={onClose} className="mt-4 text-xs text-gray-500 hover:text-white">닫기</button>
      </div>
    </div>
  );
};

const ReviewModal = ({ isOpen, onClose, onAddRating, onUpdateRating, user, initialMovie, myRatings, editingReview }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [rating, setRating] = useState(0); 
  const [isRecommend, setIsRecommend] = useState(null); 
  const [reviewText, setReviewText] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (editingReview) {
        setSelectedMovie({ id: editingReview.id, title: editingReview.title, poster: editingReview.poster });
        setRating(editingReview.rating || 0);
        setIsRecommend(editingReview.isRecommend);
        setReviewText(editingReview.comment || '');
        setSearchTerm(''); setSearchResults([]);
      } else if (initialMovie) {
        setSelectedMovie({ id: initialMovie.id, title: initialMovie.title, poster: initialMovie.poster });
        setSearchTerm(''); setSearchResults([]);
        setRating(0); setIsRecommend(null); setReviewText('');
      } else {
        setSelectedMovie(null); setSearchTerm('');
        setRating(0); setIsRecommend(null); setReviewText('');
      }
    }
  }, [isOpen, initialMovie, editingReview]);

  useEffect(() => {
    if (!searchTerm.trim() || TMDB_API_KEY === 'YOUR_TMDB_API_KEY') return setSearchResults([]);
    const timer = setTimeout(async () => {
      try {
        const [resMovie, resTv] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`),
          fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`)
        ]);
        const dataMovie = await resMovie.json();
        const dataTv = await resTv.json();
        
        const combined = [
          ...(dataMovie.results || []).map(m => ({ ...m, title: m.title || m.name })),
          ...(dataTv.results || []).map(t => ({ ...t, title: t.name || t.title }))
        ].sort((a, b) => b.popularity - a.popularity).slice(0, 10);
        
        setSearchResults(combined);
      } catch (e) {}
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (isRecommend === null || rating === 0) return alert("추천 여부와 평점을 선택해주세요!");
    
    if (editingReview) {
      const updatedObj = {
        ...editingReview,
        rating: Number(rating), isRecommend, comment: reviewText || '평가 완료', date: new Date().toISOString() 
      };
      try {
        if (db) await updateDoc(doc(db, "ratings", editingReview.docId), updatedObj);
        onUpdateRating(updatedObj);
        onClose();
      } catch (e) { alert("수정 중 오류가 발생했습니다."); }
    } else {
      const hasAlreadyRated = myRatings.some(r => String(r.id) === String(selectedMovie.id));
      if (hasAlreadyRated) {
        return alert("이미 평점을 남기신 영화입니다.");
      }
      
      const newRatingObj = {
        uid: user.uid, nickname: user.nickname, id: selectedMovie.id, title: selectedMovie.title, poster: selectedMovie.poster,
        rating: Number(rating), isRecommend, comment: reviewText || '평가 완료', date: new Date().toISOString() 
      };

      try {
        if (db) await addDoc(collection(db, "ratings"), newRatingObj);
        onAddRating(newRatingObj); 
        onClose();
      } catch (e) { alert("저장 중 오류가 발생했습니다."); }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg p-6 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{editingReview ? '평점 수정하기' : '평점 남기기'}</h2>
          <button onClick={onClose} className="text-gray-400 text-3xl font-bold hover:text-white">&times;</button>
        </div>
        {!selectedMovie ? (
          <div>
            <input type="text" className="w-full p-3 bg-gray-800 rounded mb-3 text-white border border-gray-700 outline-none focus:border-red-500" placeholder="작품 제목 검색..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <div className="max-h-60 overflow-y-auto bg-gray-800 rounded border border-gray-700">
              {searchResults.map(m => (
                <div key={m.id} className="p-3 hover:bg-gray-700 cursor-pointer border-b border-gray-700 flex justify-between items-center" 
                     onClick={() => setSelectedMovie({ id: m.id, title: m.title, poster: m.poster_path ? `${TMDB_IMAGE_BASE}${m.poster_path}` : `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(m.title)}` })}>
                  <span>{m.title}</span><span className="text-xs text-gray-500">{m.media_type === 'tv' || m.first_air_date ? 'TV/드라마' : '영화'}</span>
                </div>
              ))}
              {searchTerm && (
                <div className="p-3 bg-red-900/30 hover:bg-red-900/50 cursor-pointer text-center text-red-400 font-bold" 
                     onClick={() => setSelectedMovie({ id: Date.now(), title: searchTerm, poster: `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(searchTerm)}` })}>
                  목록에 없나요? 직접 등록하기
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-full mt-4 bg-gray-700 hover:bg-gray-600 py-3 font-bold text-white rounded transition-colors">닫기</button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex gap-4 items-center bg-gray-800 p-4 rounded relative border border-gray-700">
              {!initialMovie && !editingReview && (
                <button onClick={() => setSelectedMovie(null)} className="absolute top-3 right-3 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-white">다른 작품 검색</button>
              )}
              <img src={selectedMovie.poster} alt="" className="w-16 h-24 object-cover rounded shadow-md" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(selectedMovie.title)}`; }} />
              <h3 className="font-bold text-lg pr-20">{selectedMovie.title}</h3>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-3 text-center">이 작품을 추천하시나요?</label>
              <div className="flex justify-center gap-4">
                <button onClick={() => setIsRecommend(true)} className={`flex items-center gap-2 px-8 py-3 rounded-full border transition-all font-bold ${isRecommend === true ? 'bg-green-600 border-green-500 text-white shadow-lg' : 'border-gray-600 text-gray-400 hover:bg-gray-800'}`}>👍 추천합니다</button>
                <button onClick={() => setIsRecommend(false)} className={`flex items-center gap-2 px-8 py-3 rounded-full border transition-all font-bold ${isRecommend === false ? 'bg-red-600 border-red-500 text-white shadow-lg' : 'border-gray-600 text-gray-400 hover:bg-gray-800'}`}>👎 별로예요</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 text-center">정확한 평점 ({rating}점 / 10점 만점)</label>
              <div className="flex justify-center text-5xl">
                {[1, 2, 3, 4, 5].map((star) => (
                  <div key={star} className="relative cursor-pointer w-12 h-12 mx-1 flex justify-center items-center">
                    <span className="text-gray-600 absolute">★</span>
                    <span className="text-yellow-400 absolute top-0 left-0 overflow-hidden whitespace-nowrap" style={{ width: rating >= star * 2 ? '100%' : rating === star * 2 - 1 ? '50%' : '0%' }}>★</span>
                    <div className="absolute top-0 left-0 w-1/2 h-full z-10" onClick={() => setRating(star * 2 - 1)}></div>
                    <div className="absolute top-0 right-0 w-1/2 h-full z-10" onClick={() => setRating(star * 2)}></div>
                  </div>
                ))}
              </div>
            </div>
            <textarea className="w-full p-4 bg-gray-800 rounded text-white resize-none h-24 border border-gray-700 focus:border-red-500 outline-none" placeholder="한줄평을 남겨주세요." value={reviewText} onChange={e => setReviewText(e.target.value)} />
            
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 py-4 font-bold rounded shadow-lg transition-colors">취소</button>
              <button onClick={handleSubmit} className="flex-1 bg-red-600 hover:bg-red-700 py-4 font-extrabold text-lg rounded shadow-lg transition-colors">
                {editingReview ? '수정 완료' : 'DB에 등록하기'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminNewReleaseRow = ({ label, value, onChange }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!searchTerm.trim()) return setResults([]);
    const timer = setTimeout(async () => {
      try {
        const [resM, resT] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`),
          fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`)
        ]);
        const dataM = await resM.json();
        const dataT = await resT.json();
        const combined = [...(dataM.results||[]).map(m=>({...m, title:m.title||m.name})), ...(dataT.results||[]).map(t=>({...t, title:t.name||t.title}))].slice(0,5);
        setResults(combined);
      } catch(e){}
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleOpinion = (idx, field, val) => {
    const newOps = [...(value.opinions || [])];
    newOps[idx] = { ...newOps[idx], [field]: val };
    onChange({ ...value, opinions: newOps });
  };

  if (value.title) {
    return (
      <div className="mb-4 bg-blue-900/20 p-4 rounded-xl border border-blue-700 shadow-lg">
         <div className="flex justify-between items-center mb-3">
           <h3 className="font-extrabold text-blue-400 text-lg">{label}</h3>
           <button onClick={() => onChange({...value, title: '', movieId: null, poster: ''})} className="text-xs bg-gray-700 px-3 py-1.5 rounded font-bold hover:bg-gray-600">다시 검색</button>
         </div>
         <div className="flex gap-4 items-center mb-4 bg-gray-900 p-3 rounded-lg border border-gray-700">
           <img src={value.poster} alt="" className="w-12 h-16 object-cover rounded shadow-md" />
           <span className="font-bold text-white">{value.title}</span>
         </div>
         
         <div className="mb-4">
           <h4 className="text-xs font-bold text-blue-300 mb-2">💡 패널별 평가 (체크 시 개별 한줄평 입력 가능)</h4>
           {(value.opinions || []).map((op, idx) => (
             <div key={idx} className={`flex flex-col gap-2 mb-2 p-2 rounded-lg border transition-colors ${op.active ? 'bg-gray-800 border-gray-600' : 'bg-gray-900 border-gray-800'}`}>
               <div className="flex items-center gap-2">
                 <input type="checkbox" checked={op.active} onChange={e => handleOpinion(idx, 'active', e.target.checked)} className="w-4 h-4 cursor-pointer accent-blue-500 shrink-0" />
                 {op.critic === '기타' ? (
                  <div className="flex gap-2">
        <input 
          type="text" 
          placeholder="이름 직접 입력" 
          value={op.customName || ''} 
          onChange={e => handleOpinion(idx, 'customName', e.target.value)}
          className="w-24 bg-gray-900 text-white p-1 border border-gray-700 rounded text-xs focus:outline-none focus:border-red-500"
        />
        <select 
          value={op.job || '평론가'}
          onChange={e => handleOpinion(idx, 'job', e.target.value)}
          className="w-20 bg-gray-900 text-white p-1 border border-gray-700 rounded text-xs focus:outline-none focus:border-red-500"
        >
          <option value="평론가">평론가</option>
          <option value="배우">배우</option>
          <option value="가수">가수</option>
          <option value="방송인">방송인</option>
          <option value="감독">감독</option>
          <option value="기자">기자</option>
        </select>
      </div>                 ) : (
                   <span className={`text-xs w-12 font-bold ${op.active ? 'text-white' : 'text-gray-500'}`}>{op.critic}</span>
                 )}
                 <div className="flex gap-1 flex-1">
                   <button disabled={!op.active} onClick={() => handleOpinion(idx, 'isRecommend', op.isRecommend === true ? null : true)} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors disabled:opacity-30 ${op.isRecommend === true ? 'bg-green-600 text-white shadow-md' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>👍 추천</button>
                   <button disabled={!op.active} onClick={() => handleOpinion(idx, 'isRecommend', op.isRecommend === false ? null : false)} className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-colors disabled:opacity-30 ${op.isRecommend === false ? 'bg-red-600 text-white shadow-md' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>👎 비추천</button>
                 </div>
                 <div className="flex items-center gap-1 shrink-0">
                   <span className="text-yellow-400 text-xs">★</span>
                   <input type="number" step="0.5" min="0" max="10" value={op.rating === undefined ? 8.0 : op.rating} onChange={e => handleOpinion(idx, 'rating', Number(e.target.value))} disabled={!op.active} className="w-12 p-1 bg-gray-900 border border-gray-600 rounded text-white text-xs text-center outline-none focus:border-blue-500 disabled:opacity-50" />
                 </div>
               </div>
               {/* 🔥 개별 한줄평 입력란 추가 */}
               {op.active && (
                 <textarea placeholder={`${op.critic === '기타' ? (op.customName || '기타') : op.critic}의 한줄평 (선택)`} value={op.comment || ''} onChange={e => handleOpinion(idx, 'comment', e.target.value)} className="w-full p-2 bg-gray-900 text-gray-300 rounded text-xs resize-none h-12 border border-gray-700 outline-none focus:border-blue-500" />
               )}
             </div>
           ))}
         </div>
         <textarea placeholder="신작 전체 공통 한줄평 (선택)" value={value.comment} onChange={e => onChange({...value, comment: e.target.value})} className="w-full p-3 bg-gray-900 text-white rounded-lg text-sm resize-none h-16 border border-gray-700 outline-none focus:border-blue-500" />
      </div>
    );
  }
  
  return (
    <div className="mb-4 bg-gray-800 p-4 rounded-xl border border-gray-700">
       <h3 className="font-extrabold text-blue-400 mb-3 text-lg">{label}</h3>
       <input type="text" placeholder="신작 영화 검색..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-3 bg-gray-900 text-white rounded-lg border border-gray-700 outline-none focus:border-blue-500 font-bold" />
       {results.length > 0 && (
         <div className="mt-2 max-h-40 overflow-y-auto bg-gray-900 rounded-lg border border-gray-700 shadow-xl">
           {results.map(m => (
             <div key={m.id} className="p-3 hover:bg-gray-700 cursor-pointer text-sm flex justify-between items-center border-b border-gray-800 transition-colors" onClick={() => {
               onChange({...value, movieId: m.id, title: m.title, poster: m.poster_path ? `${TMDB_IMAGE_BASE}${m.poster_path}` : `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(m.title)}`});
               setSearchTerm(''); setResults([]);
             }}>
               <span className="font-bold text-white">{m.title}</span>
             </div>
           ))}
         </div>
       )}
    </div>
  );
};
const AdminCinemaInputRow = ({ label, value, onChange, isNewRelease, isOther }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!searchTerm.trim()) return setResults([]);
    const timer = setTimeout(async () => {
      try {
        const [resM, resT] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`),
          fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&language=ko-KR&query=${searchTerm}&page=1`)
        ]);
        const dataM = await resM.json();
        const dataT = await resT.json();
        const combined = [...(dataM.results||[]).map(m=>({...m, title:m.title||m.name})), ...(dataT.results||[]).map(t=>({...t, title:t.name||t.title}))].slice(0,5);
        setResults(combined);
      } catch(e){}
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  if (value.title) {
    return (
      <div className="mb-4 bg-gray-800 p-4 rounded-lg border border-gray-700">
         <div className="flex justify-between items-center mb-2">
           <h3 className="font-bold text-white text-lg">{label}</h3>
           <button onClick={() => onChange({...value, title: '', movieId: null, poster: ''})} className="text-xs bg-gray-700 px-2 py-1 rounded">다시 검색</button>
         </div>
         {isOther && (
  <div className="mb-2 flex gap-2">
    <input 
      type="text" 
      placeholder="게스트 이름 직접 입력 (예: 황석정)" 
      value={value.customName || value.name || ''} 
      onChange={(e) => onChange({ ...value, customName: e.target.value, name: e.target.value })}
      className="flex-1 bg-gray-900 text-white p-2 border border-gray-700 rounded text-sm focus:outline-none focus:border-red-500"
    />
    <select 
      value={value.job || '평론가'}
      onChange={(e) => onChange({ ...value, job: e.target.value })}
      className="w-1/3 bg-gray-900 text-white p-2 border border-gray-700 rounded text-sm focus:outline-none focus:border-red-500"
    >
      <option value="평론가">평론가</option>
      <option value="배우">배우</option>
      <option value="가수">가수</option>
      <option value="방송인">방송인</option>
      <option value="감독">감독</option>
      <option value="기자">기자</option>
    </select>
  </div>
)}
         <div className="flex gap-3 items-center mb-3 bg-gray-900 p-2 rounded">
           <img src={value.poster} alt="" className="w-12 h-16 object-cover rounded shadow-md" />
           <span className="font-bold text-sm text-white">{value.title}</span>
         </div>
         
         {!isNewRelease && (
           <div className="flex gap-2 mb-2 items-center">
             <button onClick={() => onChange({...value, isRecommend: true})} className={`flex-1 py-1.5 rounded text-sm font-bold ${value.isRecommend ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>👍 추천</button>
             <button onClick={() => onChange({...value, isRecommend: false})} className={`flex-1 py-1.5 rounded text-sm font-bold ${value.isRecommend === false ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}>👎 비추천</button>
             
             {/* 🔥 평점 직접 입력칸 추가 */}
             <div className="flex items-center gap-1 shrink-0 ml-2">
               <span className="text-yellow-400 font-bold">★</span>
               <input type="number" step="0.5" min="0" max="10" value={value.rating === undefined ? 8.0 : value.rating} onChange={e => onChange({...value, rating: Number(e.target.value)})} className="w-16 p-1.5 bg-gray-900 border border-gray-600 rounded text-white text-sm text-center outline-none focus:border-red-500" />
             </div>
           </div>
         )}
         
         <textarea placeholder="한줄평 (선택)" value={value.comment} onChange={e => onChange({...value, comment: e.target.value})} className="w-full p-2 bg-gray-900 text-white rounded text-sm resize-none h-12 border border-gray-700 outline-none focus:border-red-500" />
      </div>
    );
  }

  return (
    <div className="mb-4 bg-gray-800 p-4 rounded-lg border border-gray-700">
       <h3 className="font-bold text-white mb-2 text-lg">{label}</h3>
       <input type="text" placeholder="작품 검색 (비워두면 등록 안 됨)" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-2 bg-gray-900 text-white rounded border border-gray-700 outline-none focus:border-red-500" />
       {results.length > 0 && (
         <div className="mt-2 max-h-40 overflow-y-auto bg-gray-900 rounded border border-gray-700">
           {results.map(m => (
             <div key={m.id} className="p-3 hover:bg-gray-700 cursor-pointer text-sm flex justify-between items-center border-b border-gray-800" onClick={() => {
               onChange({...value, movieId: m.id, title: m.title, poster: m.poster_path ? `${TMDB_IMAGE_BASE}${m.poster_path}` : `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(m.title)}`});
               setSearchTerm(''); setResults([]);
             }}>
               <span className="font-bold">{m.title}</span><span className="text-gray-500 text-[10px]">{m.media_type === 'tv' || m.first_air_date ? 'TV' : '영화'}</span>
             </div>
           ))}
         </div>
       )}
    </div>
  );
};

const AdminCinemaModal = ({ isOpen, onClose, onRefresh, editData }) => {
  const [date, setDate] = useState(getRecentFridayKST());
  
  // 🔥 rating 8.0 기본값 세팅 추가
  const initialFormState = { title: '', isRecommend: true, comment: '', docId: null, movieId: null, poster: '', rating: 8.0 };
  
  const initialNewReleaseState = { 
    ...initialFormState,
    opinions: [
      { critic: '라이너', isRecommend: null, active: false, rating: 8.0, comment: '' },
      { critic: '거의없다', isRecommend: null, active: false, rating: 8.0, comment: '' },
      { critic: '전찬일', isRecommend: null, active: false, rating: 8.0, comment: '' },
      { critic: '기타', customName: '', job: '평론가', isRecommend: null, active: false, rating: 8.0, comment: '' }
    ]
  };

  const [newRelease, setNewRelease] = useState({ ...initialNewReleaseState });
  const [jeon, setJeon] = useState({ ...initialFormState });
  const [liner, setLiner] = useState({ ...initialFormState });
  const [none, setNone] = useState({ ...initialFormState });
// 기존 컴포넌트가 요구하는 title, isRecommend 등을 포함하기 위해 ...initialFormState를 사용합니다.
const [guests, setGuests] = useState([
  { id: Date.now(), name: '', job: '평론가', ...initialFormState }
]);

const addGuest = () => {
  setGuests([...guests, { id: Date.now(), name: '', job: '평론가', ...initialFormState }]);
};
  
  const removeGuest = (id) => {
    setGuests(guests.filter(guest => guest.id !== id));
  };
  
  const handleGuestChange = (id, field, value) => {
    setGuests(guests.map(guest => 
      guest.id === id ? { ...guest, [field]: value } : guest
    ));
  };
  const [other, setOther] = useState({ ...initialFormState, otherName: '직접입력', customName: '' });

  useEffect(() => {
    if (isOpen) {
      if (editData && editData.length > 0) {
        setDate(editData[0].broadcastDate);
        let nR = { ...initialNewReleaseState }, j = { ...initialFormState }, l = { ...initialFormState }, n = { ...initialFormState };
        
        // ⭐️ 기존 데이터를 담을 빈 배열 준비
        let loadedGuests = []; 
  
        editData.forEach(r => {
          // DB에서 불러온 데이터를 매핑
          const mappedData = { title: r.title, poster: r.poster, isRecommend: r.isRecommend, comment: r.comment, docId: r.id, rating: r.rating || 8.0 };
  
          if (r.panelName === '신작') nR = { ...mappedData, opinions: r.opinions || nR.opinions };
          else if (r.panelName === '전찬일') j = mappedData;
          else if (r.panelName === '라이너') l = mappedData;
          else if (r.panelName === '거의없다') n = mappedData;
          else {
            // ⭐️ 신작/전찬일/라이너/거의없다가 아니면(즉, 기타 게스트면) 무조건 guests 배열에 쏙쏙 집어넣기!
            loadedGuests.push({
              id: r.id || Date.now() + Math.random(),
              name: r.reviewerName || '', 
              job: r.reviewerJob || '평론가', // DB에 직업이 없으면 평론가로 기본 세팅
              ...mappedData
            });
          }
        });
  
        setNewRelease(nR); setJeon(j); setLiner(l); setNone(n);
        
        // 불러온 게스트가 있으면 그걸 보여주고, 없으면 빈 칸 1개 띄우기
        if (loadedGuests.length > 0) {
          setGuests(loadedGuests);
        } else {
          setGuests([{ id: Date.now(), name: '', job: '평론가', ...initialFormState }]);
        }
      } else {
        // 신규 등록일 때 (빈 화면 세팅)
        setDate(getRecentFridayKST());
        setNewRelease({ ...initialNewReleaseState }); 
        setJeon({ ...initialFormState }); 
        setLiner({ ...initialFormState }); 
        setNone({ ...initialFormState });
        setGuests([{ id: Date.now(), name: '', job: '평론가', ...initialFormState }]);
      }
    }
  }, [isOpen, editData]);

  const handleSubmit = async () => {
    const entries = [
      { panel: '신작', data: newRelease }, 
      { panel: '전찬일', data: jeon }, 
      { panel: '라이너', data: liner },
      { panel: '거의없다', data: none }
    ];
  
    guests.forEach(guest => {
      if (guest.title) { 
        entries.push({ panel: '기타', data: guest });
      }
    });

    let hasData = false;
    try {
      if (db) {
        for (const entry of entries) {
          if (entry.data.title.trim()) {
            hasData = true;
// 1. 이름이 비어있으면 '기타 게스트'라는 기본값을 주어 에러 방지
const finalPanelName = entry.panel === '기타' ? (entry.data.name || entry.data.customName || '기타 게스트') : entry.panel;

// 2. 파이어베이스 에러 방지를 위해 모든 항목에 꼼꼼하게 기본값(||) 세팅
const reviewObj = {
  id: entry.data.movieId || Date.now() + Math.random(),
  title: entry.data.title || '', 
  poster: entry.data.poster || '',
  rating: entry.data.rating !== undefined ? entry.data.rating : 8.0,
  isRecommend: entry.panel === '신작' ? true : (entry.data.isRecommend !== undefined ? entry.data.isRecommend : null),
  opinions: entry.panel === '신작' ? (entry.data.opinions || []) : null,
  comment: entry.data.comment || '',
  panelName: entry.panel || '기타',
  reviewerName: finalPanelName, 
  reviewerJob: entry.data.job || '평론가', 
  broadcastDate: date || ''
};

// 3. (핵심) 혹시라도 객체 안에 undefined가 남아있다면 파이어베이스가 튕겨내므로 강제로 싹 지워주는 안전장치
Object.keys(reviewObj).forEach(key => reviewObj[key] === undefined && delete reviewObj[key]);
            
if (entry.data.docId) {
  // docId를 강제로 문자열로 변환하여 에러 원천 차단!
  await updateDoc(doc(db, "cinema_reviews", String(entry.data.docId)), reviewObj);
} else {
  await addDoc(collection(db, "cinema_reviews"), reviewObj);
}
} else if (entry.data.docId) {
// 삭제할 때도 마찬가지로 문자열로 감싸주기!
await deleteDoc(doc(db, "cinema_reviews", String(entry.data.docId)));
}
        }
      }
      if (!hasData && !editData) return alert("등록할 작품 제목을 최소 하나 이상 검색/입력해주세요.");
      
      onRefresh();
      onClose();
    } catch(e) {
      console.error("🔥 진짜 에러 원인은 이거야! :", e); // ⭐️ 파이어베이스 에러를 콘솔에 출력하는 코드 추가
      alert("DB 저장/수정에 실패했습니다.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-xl p-6 text-white max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h2 className="text-xl font-bold text-red-500">{editData ? '🎬 시네마지옥 기록 수정' : '🎬 시네마지옥 일괄 등록'}</h2>
          <button onClick={onClose} className="text-gray-400 text-3xl font-bold hover:text-white">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
          <label className="block text-sm text-gray-400 mb-1">방송 날짜 (KST 기준 자동 세팅)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 bg-gray-800 rounded-lg mb-6 border border-gray-700 outline-none text-white focus:border-red-500" />
          <AdminNewReleaseRow label="[신작 소개작]" value={newRelease} onChange={setNewRelease} />
          <AdminCinemaInputRow label="[전찬일]" value={jeon} onChange={setJeon} />
          <AdminCinemaInputRow label="[라이너]" value={liner} onChange={setLiner} />
          <AdminCinemaInputRow label="[거의없다]" value={none} onChange={setNone} />
{/* 동적 기타 게스트 입력란 시작 */}
{guests.map((guest, index) => (
  <div key={guest.id} className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
    <div className="flex justify-between items-center mb-2">
      <h3 className="text-white font-bold text-sm">[기타 게스트 {index + 1}]</h3>
      <button onClick={() => removeGuest(guest.id)} className="text-red-500 text-xs hover:text-red-400">
        삭제 ✕
      </button>
    </div>

    {/* 이름 입력칸 + 직업 드롭다운 */}
    <div className="flex gap-2 mb-3">
      <input 
        type="text" 
        placeholder="이름 직접 입력 (예: 황석정)"
        value={guest.name}
        onChange={(e) => handleGuestChange(guest.id, 'name', e.target.value)}
        className="flex-1 bg-gray-900 text-white p-2 border border-gray-700 rounded text-sm focus:outline-none focus:border-red-500"
      />
      <select 
        value={guest.job}
        onChange={(e) => handleGuestChange(guest.id, 'job', e.target.value)}
        className="w-1/3 bg-gray-900 text-white p-2 border border-gray-700 rounded text-sm focus:outline-none focus:border-red-500"
      >
        <option value="평론가">평론가</option>
        <option value="배우">배우</option>
        <option value="가수">가수</option>
        <option value="방송인">방송인</option>
        <option value="감독">감독</option>
        <option value="기자">기자</option>
      </select>
    </div>

    {/* 기존의 작품 검색 및 별점 컴포넌트 재사용 */}
    <AdminCinemaInputRow 
      label="" 
      value={guest} 
      onChange={(newValue) => {
        setGuests(guests.map(g => g.id === guest.id ? { ...g, ...newValue } : g));
      }} 
    />
  </div>
))}

{/* 게스트 추가 버튼 */}
<button 
  onClick={addGuest}
  className="w-full mt-3 py-2 border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 font-bold rounded-lg transition text-sm"
>
  + 기타 게스트 폼 추가하기
</button>
{/* 동적 기타 게스트 입력란 끝 */}
        </div>
        
        <div className="mt-6 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 py-4 font-bold rounded-xl text-lg transition-colors">취소</button>
          <button onClick={handleSubmit} className="flex-1 bg-red-600 hover:bg-red-700 py-4 font-bold rounded-xl text-lg shadow-lg transition-colors">
            {editData ? '저장하기' : '일괄 등록하기'}
          </button>
        </div>
      </div>
    </div>
  );
};
const AdminUserSection = () => {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!db) return;
      try {
        const snap = await getDocs(collection(db, "users"));
        const fetched = [];
        snap.forEach(doc => fetched.push(doc.data()));
        // 가입일(createdAt) 기준으로 최신 가입자가 위로 오도록 정렬 (과거 가입자는 날짜가 없으므로 아래로)
        fetched.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setUsers(fetched);
      } catch(e) { console.error(e); }
    };
    fetchUsers();
  }, []);

  return (
    <section className="animate-fadeIn">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white">👑 운영자 전용 <span className="text-red-500">회원 관리</span></h2>
        <span className="bg-gray-800 border border-gray-700 text-gray-300 px-4 py-2 rounded-lg font-bold">
          총 가입자: {users.length}명
        </span>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="bg-gray-900 text-gray-400 font-bold border-b border-gray-700">
              <tr>
                <th className="p-4">No.</th>
                <th className="p-4">닉네임</th>
                <th className="p-4">이메일</th>
                <th className="p-4">가입일</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr key={u.uid} className="border-b border-gray-800 hover:bg-gray-700 transition-colors">
                  <td className="p-4 font-bold text-gray-500">{users.length - idx}</td>
                  <td className="p-4 font-bold text-white">{u.nickname} {u.nickname === '넷플픽' && '👑'}</td>
                  <td className="p-4 text-gray-400">{u.email}</td>
                  <td className="p-4 text-gray-500">
                    {u.createdAt ? new Date(u.createdAt).toLocaleString('ko-KR') : '날짜 기록 없음(초기 멤버)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
const CinemaHellSection = ({ isAdmin, onMovieClick, onRefreshGlobal }) => {
  const [activePanel, setActivePanel] = useState('전체');
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [editData, setEditData] = useState(null); 
  const [cinemaReviews, setCinemaReviews] = useState([]);

  const fetchCinemaReviews = async () => {
    if (!db) return;
    try {
      const q = query(collection(db, "cinema_reviews"), orderBy("broadcastDate", "desc"));
      const snap = await getDocs(q);
      const fetched = [];
      snap.forEach(doc => fetched.push({ dbId: doc.id, ...doc.data() }));
      setCinemaReviews(fetched);
      if (onRefreshGlobal) onRefreshGlobal();
    } catch (e) {
      console.error("시네마지옥 기록 로딩 실패:", e);
    }
  };

  useEffect(() => {
    fetchCinemaReviews();
  }, []);

  const openNewModal = () => {
    setEditData(null);
    setIsAdminModalOpen(true);
  };

  const openEditModal = (reviewsForDate) => {
    setEditData(reviewsForDate);
    setIsAdminModalOpen(true);
  };

  const groupedByDate = useMemo(() => {
    if (activePanel !== '전체') return {};
    return cinemaReviews.reduce((acc, review) => {
      const date = review.broadcastDate || '날짜 미상';
      if (!acc[date]) acc[date] = [];
      acc[date].push(review);
      return acc;
    }, {});
  }, [cinemaReviews, activePanel]);

  const panelCounts = useMemo(() => {
    const counts = {};
    cinemaReviews.forEach(r => { counts[r.panelName] = (counts[r.panelName] || 0) + 1; });
    return counts;
  }, [cinemaReviews]);

  const visiblePanels = CINEMA_HELL_PANELS;

  const filteredReviews = activePanel === '전체' ? [] : cinemaReviews.filter(r => r.panelName === activePanel).sort((a,b) => b.rating - a.rating);

  return (
    <section className="animate-fadeIn">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white">🎬 매불쇼 <span className="text-red-500">시네마지옥</span></h2>
        {isAdmin && (
          <button onClick={openNewModal} className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-4 py-2 rounded-md shadow-lg transition-colors">✏️ 방송 기록 등록</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {visiblePanels.map(panel => (
          <button key={panel} onClick={() => setActivePanel(panel)} className={`px-6 py-2 rounded-full font-bold transition-all ${activePanel === panel ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{panel}</button>
        ))}
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 min-h-[300px]">
        {cinemaReviews.length === 0 ? (
          <div className="text-center py-20 text-gray-500">등록된 시네마지옥 리뷰가 없습니다.</div>
        ) : activePanel === '전체' ? (
          <div className="flex flex-col gap-8">
            {Object.keys(groupedByDate).sort((a,b) => b.localeCompare(a)).map(date => (
              <div key={date} className="animate-fadeIn">
                
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                   <h3 className="text-xl font-bold text-white">{date} 방송</h3>
                   {isAdmin && (
                     <button onClick={() => openEditModal(groupedByDate[date])} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded font-bold transition-colors">기록 수정</button>
                   )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedByDate[date].map((review, index) => (
                    <div key={`${review.dbId}-${index}`} onClick={() => onMovieClick(review)} className="bg-gray-900 p-4 rounded-lg flex gap-4 border border-gray-700 hover:border-gray-500 cursor-pointer transition-colors group relative">
<div className={`absolute -top-3 -left-3 text-[12px] sm:text-sm font-extrabold px-3 py-1 rounded-full shadow-md z-10 backdrop-blur-sm ${review.panelName === '신작' ? 'bg-blue-600 text-white border border-blue-500' : (review.isRecommend === 'both' ? 'bg-yellow-900/80 text-yellow-400 border border-yellow-700/50' : (review.isRecommend ? 'bg-green-900/80 text-green-400 border border-green-700/50' : 'bg-red-900/80 text-red-400 border border-red-700/50'))}`}>                      {review.panelName === '신작' ? '🎬 신작 소개작' : `${review.reviewerName} ${review.isRecommend === 'both' ? '🤔' : (review.isRecommend ? '👍' : '👎')}`}              </div>
              <img src={review.poster} onClick={() => onMovieClick(review)} alt="" className="w-16 h-24 object-cover rounded shadow-md bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity shrink-0" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(review.title)}`; }} />
              <div className="flex flex-col justify-center w-full overflow-hidden flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
                  <h3 className="text-lg font-bold text-white cursor-pointer hover:text-red-400 transition-colors truncate" onClick={() => onMovieClick(review)}>{review.title}</h3>
                </div>

                {/* 🔥 신작 패널별 의견 쫙 뿌려주는 영역 */}
                {review.panelName === '신작' && review.opinions && (
                  <div className="flex flex-wrap gap-1 mb-1.5 mt-0.5">
                    {review.opinions.filter(op => op.active).map((op, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold border ${op.isRecommend ? 'bg-green-900/40 text-green-400 border-green-700' : 'bg-red-900/40 text-red-400 border-red-700'}`}>
                        {op.critic === '기타' ? op.customName : op.critic} {op.isRecommend ? '👍' : '👎'}
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-yellow-400 text-sm font-bold mb-1">★ {Number(review.rating).toFixed(1)}</div>
                {review.panelName !== '신작' && <span className="text-gray-500 text-[10px] mb-1">{review.broadcastDate || (review.date ? new Date(review.date).toLocaleDateString('ko-KR') : '')}</span>}
                <p className="text-gray-300 text-xs truncate">"{review.comment}"</p>
              </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
            {filteredReviews.map((review, index) => (
              <div key={`${review.dbId}-${index}`} onClick={() => onMovieClick(review)} className="relative bg-gray-800 rounded-xl p-6 border border-gray-700 min-h-[140px] cursor-pointer hover:border-gray-500 transition-all shadow-lg">
  
              {/* 🔥 1. 오직 '기타' 탭에서만 뱃지 노출 (activePanel 조건 추가) */}
              {/* 🔥 2. absolute -top-3 -left-3 로 포스터가 아닌 카드 밖 테두리에 위치 */}
              {activePanel === '기타' && (
                <div className={`absolute -top-3 -left-3 text-[12px] sm:text-sm font-extrabold px-3 py-1 rounded-full shadow-md z-10 backdrop-blur-sm ${review.isRecommend === 'both' ? 'bg-yellow-900/80 text-yellow-400 border border-yellow-700/50' : (review.isRecommend ? 'bg-green-900/80 text-green-400 border border-green-700/50' : 'bg-red-900/80 text-red-400 border border-red-700/50')}`}>
                  {/* 🔥 3. 이름 옆에 나란히 엄지손가락 배치 (대괄호 제거됨) */}
                  {review.reviewerName} {review.isRecommend === 'both' ? '🤔' : (review.isRecommend ? '👍' : '👎')}
                </div>
              )}
            
              <div className="flex gap-4">
                {/* 포스터는 뱃지에 가려지지 않고 온전히 노출됩니다 */}
                <img src={review.poster} alt="" className="w-16 h-24 object-cover rounded shadow-md shrink-0" />
                
                <div className="flex flex-col flex-grow min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <h4 className="text-md font-bold text-white leading-tight truncate">{review.title}</h4>
                  </div>
                  
                  <p className="text-yellow-400 text-sm font-bold mb-1">★ {Number(review.rating).toFixed(1)}</p>
                  <p className="text-gray-500 text-[10px] mb-1.5">{review.broadcastDate}</p>
                  <p className="text-gray-300 text-xs truncate">{review.comment}</p>
                </div>
              </div>
            </div>
            ))}
          </div>
        )}
      </div>
      <AdminCinemaModal isOpen={isAdminModalOpen} onClose={() => setIsAdminModalOpen(false)} onRefresh={fetchCinemaReviews} editData={editData} />
    </section>
  );
};


// ==========================================
// 4. 메인 앱 (라우팅 및 전체 상태 관리)
// ==========================================
export default function App() {
  return (
    <HelmetProvider>
      <Router>
        <MainApp />
      </Router>
      <Analytics />
    </HelmetProvider>
  );
}

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  
  const [selectedMovieForReview, setSelectedMovieForReview] = useState(null);
  const [editingReview, setEditingReview] = useState(null); 
  
  const [dbUser, setDbUser] = useState(null); 
  const [myRatings, setMyRatings] = useState([]); 
  
  const [allRatings, setAllRatings] = useState([]);
  const [allCinemaReviews, setAllCinemaReviews] = useState([]);

  const [latestMovies, setLatestMovies] = useState([]);
  const [bestMovies, setBestMovies] = useState([]);
  const [worstMovies, setWorstMovies] = useState([]);
  const [globalLatestReviews, setGlobalLatestReviews] = useState([]);

  const isAdmin = dbUser?.nickname === '넷플픽';

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && db) {
         try {
           const userRef = doc(db, "users", currentUser.uid);
           const userSnap = await getDoc(userRef);
           if (userSnap.exists()) {
             setDbUser(userSnap.data());
             fetchMyRatingsFromDB(currentUser.uid);
           } else setShowNicknameModal(true);
         } catch(e) { console.error(e); }
      } else {
        setDbUser(null);
        setMyRatings([]); 
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchAllMovieData = async () => {
    if (!db) return;
    try {
      const ratingsSnap = await getDocs(query(collection(db, "ratings"), orderBy("date", "desc")));
      const cinemaSnap = await getDocs(query(collection(db, "cinema_reviews"), orderBy("broadcastDate", "desc")));

      const tempAllRatings = [];
      ratingsSnap.forEach(doc => tempAllRatings.push({ docId: doc.id, ...doc.data(), isCinema: false }));
      setAllRatings(tempAllRatings);

      const tempCinema = [];
      cinemaSnap.forEach(doc => {
        const data = doc.data();
        
        // 🔥 신작 패널의 개별 의견을 독립적인 데이터로 쪼개어 전체 카운트에 반영합니다.
        if (data.panelName === '신작' && data.opinions) {
          data.opinions.forEach((op, index) => {
            if (op.active) {
              tempCinema.push({
                docId: `${doc.id}_${index}`, id: data.id, title: data.title, poster: data.poster,
                rating: op.rating || data.rating, 
                isRecommend: op.isRecommend,
                date: data.broadcastDate, isCinema: true,
                reviewerName: op.critic === '기타' ? (op.customName || '기타') : op.critic,
                comment: op.comment || data.comment
              }); 
            }
          });
        } else {
          tempCinema.push({ docId: doc.id, ...data, date: data.broadcastDate, isCinema: true });
        }
      });
      setAllCinemaReviews(tempCinema);

      const movieMap = new Map();

      // 전체 평점 및 추천수 계산 로직
      const countMovieStats = (data) => {
        if (!movieMap.has(data.id)) {
          movieMap.set(data.id, { id: data.id, title: data.title, poster: data.poster, totalRating: 0, count: 0, recommends: 0, notRecommends: 0, latestDate: data.date });
        }
        const m = movieMap.get(data.id);
        m.totalRating += data.rating;
        m.count += 1;
        
        // 🔥 null(애매함) 값은 추천/비추천 어디에도 카운트되지 않도록 === true/false를 명확히 체크합니다.
        if (data.isRecommend === 'both') { m.recommends += 1; m.notRecommends += 1; }
        else if (data.isRecommend === true) m.recommends += 1;
        else if (data.isRecommend === false) m.notRecommends += 1;
        
        if (new Date(data.date) > new Date(m.latestDate)) m.latestDate = data.date;
      };

      tempAllRatings.forEach(countMovieStats);
      tempCinema.forEach(countMovieStats);

      const allMovies = Array.from(movieMap.values()).map(m => ({
        ...m,
        rating: (m.totalRating / m.count).toFixed(1)
      }));

// ==========================================
        // 🔥 수정: 30일 보장제 롤링 차트 및 랭킹 정렬 로직
        // ==========================================
        const now = new Date();
        // 💡 오늘을 기준으로 정확히 '30일 전' 날짜를 임계선으로 잡습니다.
        const thresholdDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); 

        const currentMonthMovies = [];
        const previousMovies = [];

        allMovies.forEach(m => {
          if (m.recommends > 0) {
            const mDate = new Date(m.latestDate);
            // 💡 방송된 지 30일 이내면 이번 달 추천작, 30일이 넘었으면 명작 베스트로 자동 분류!
            if (mDate >= thresholdDate) {
              currentMonthMovies.push(m);
            } else {
              previousMovies.push(m);
            }
          }
        });

        // 🏆 랭킹 정렬 공식: 1.추천자수 -> 2.평점 -> 3.최신순
        const sortRanking = (a, b) => {
          if (b.recommends !== a.recommends) return b.recommends - a.recommends;
          if (Number(b.rating) !== Number(a.rating)) return Number(b.rating) - Number(a.rating);
          return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
        };

        currentMonthMovies.sort(sortRanking);
        previousMovies.sort(sortRanking);

      const displayLatest = [
        ...currentMonthMovies,
        ...previousMovies.slice(0, Math.max(0, 10 - currentMonthMovies.length))
      ];

      setLatestMovies(displayLatest);
      setBestMovies([...allMovies].filter(m => m.recommends > 0).sort((a,b) => b.rating - a.rating));
      setWorstMovies([...allMovies].filter(m => m.notRecommends > 0).sort((a,b) => a.rating - b.rating));
      
      const allCombinedReviews = [...tempAllRatings, ...tempCinema].sort((a, b) => {
        const timeA = new Date(a.date || 0).getTime();
        const timeB = new Date(b.date || 0).getTime();
        // 에러가 나더라도 무시하고, 무조건 가장 최근 시간(큰 숫자)이 맨 위로 오게 강력 정렬!
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
     });
     setGlobalLatestReviews(allCombinedReviews.slice(0, 10));

    } catch(e) { console.error("전체 영화 로딩 실패:", e); }
  };

  useEffect(() => {
    fetchAllMovieData();
  }, [db]);

  const handleNicknameSubmit = async (nicknameInput) => {
    const trimmed = nicknameInput.trim();
    if (!trimmed) return alert("닉네임을 입력해주세요.");
    if (db) {
       const q = query(collection(db, "users"), where("nickname", "==", trimmed));
       const snap = await getDocs(q);
       if (!snap.empty) return alert("이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.");

       const newUser = { uid: auth.currentUser.uid, nickname: trimmed, email: auth.currentUser.email, createdAt: new Date().toISOString() };       await setDoc(doc(db, "users", auth.currentUser.uid), newUser);
       setDbUser(newUser);
       setShowNicknameModal(false);
       fetchMyRatingsFromDB(auth.currentUser.uid);
    }
  };

  const handleNicknameCancel = () => { if(auth) signOut(auth); setShowNicknameModal(false); };

  const fetchMyRatingsFromDB = async (uid) => {
    if(!db) return;
    try {
      const q = query(collection(db, "ratings"), orderBy("date", "desc"));
      const querySnapshot = await getDocs(q);
      const fetchedRatings = [];
      querySnapshot.forEach((doc) => {
        if(doc.data().uid === uid) fetchedRatings.push({ docId: doc.id, ...doc.data() });
      });
      setMyRatings(fetchedRatings);
    } catch (error) { console.error("DB 에러:", error); }
  };

  const handleAddRating = (newRating) => {
    setMyRatings(prev => [newRating, ...prev]);
    fetchAllMovieData(); 
  };

  const handleDeleteRating = async (docId) => {
    if (!window.confirm("정말 이 평점을 삭제하시겠습니까?")) return;
    try {
      await deleteDoc(doc(db, "ratings", docId));
      fetchMyRatingsFromDB(auth.currentUser.uid);
      fetchAllMovieData();
    } catch(e) {
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  const handleMovieClick = (movie) => {
    navigate(`/movie/${movie.id}`, { state: { movie } });
  };

   const handleOpenReviewForm = (movie) => {
    if (!dbUser) setIsLoginModalOpen(true);
    else {
      setSelectedMovieForReview(movie);
      setIsReviewModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans p-6 md:p-12">
<header className="mb-10 flex flex-col gap-4">
        <div className="flex justify-between items-center w-full">
          {/* 로고 클릭 시 기본 주소(/)로 이동 */}
          <h1 className="text-3xl font-extrabold text-red-600 cursor-pointer shrink-0" onClick={() => navigate('/')}>NETFL<span className="text-white">PICK</span></h1>
          
          <div className="flex items-center gap-3 shrink-0">
            {dbUser ? (
              <>
                <span className="text-sm text-gray-300 font-bold hidden sm:block">{dbUser.nickname}님</span>
                <button onClick={() => {if(auth) signOut(auth);}} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-2 py-1 rounded">로그아웃</button>
              </>
            ) : (
              <button onClick={() => setIsLoginModalOpen(true)} className="text-sm text-gray-300 hover:text-white font-bold">🔑 로그인</button>
            )}
            <button onClick={() => handleOpenReviewForm(null)} className="bg-white text-gray-900 font-bold px-4 py-2 rounded-md hover:bg-gray-200 transition-colors shadow-lg">✏️ 평점 남기기</button>
          </div>
        </div>

        <div className="w-full overflow-x-auto pb-2 scrollbar-hide border-t border-gray-800 pt-4">
          <nav className="flex gap-4 md:gap-6 text-sm font-medium whitespace-nowrap w-max">
            {/* 각 버튼마다 고유한 URL을 할당했습니다 */}
            <button onClick={() => navigate('/')} className={`transition-colors ${location.pathname === '/' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>추천 영화</button>
            <button onClick={() => navigate('/latest-reviews')} className={`transition-colors ${location.pathname === '/latest-reviews' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>최신 리뷰</button>
            <button onClick={() => navigate('/my-taste')} className={`transition-colors ${location.pathname === '/my-taste' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>나의 취향</button>
            <button onClick={() => navigate('/cinema-hell')} className={`transition-colors ${location.pathname === '/cinema-hell' ? 'text-red-400 font-bold border-b-2 border-red-400 pb-1' : 'text-gray-400 hover:text-red-300'}`}>매불쇼 시네마지옥</button>
            <button onClick={() => navigate('/board/general')} className={`transition-colors ${location.pathname === '/board/general' ? 'text-yellow-400 font-bold border-b-2 border-yellow-400 pb-1' : 'text-gray-400 hover:text-yellow-300'}`}>전체 게시판</button>
            <button onClick={() => navigate('/board/qna')} className={`transition-colors ${location.pathname === '/board/qna' ? 'text-blue-400 font-bold border-b-2 border-blue-400 pb-1' : 'text-gray-400 hover:text-blue-300'}`}>질문/답변</button>
            <button onClick={() => navigate('/my-ratings')} className={`transition-colors ${location.pathname === '/my-ratings' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>나의 평점</button>

            {isAdmin && (
              <button onClick={() => navigate('/admin-users')} className={`transition-colors ${location.pathname === '/admin-users' ? 'text-red-400 font-bold border-b-2 border-red-400 pb-1' : 'text-gray-400 hover:text-red-300'}`}>👑 회원 관리</button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        <Routes>
          {/* 1. 기본 홈 (추천 영화) - 검색 노출 O */}
          <Route path="/" element={
            <>
              <Helmet><title>넷플픽 - 넷플릭스 영화 평점 및 추천</title></Helmet>
              <Top10Section title={`🔥 유저들이 선택한 ${new Date().getMonth() + 1}월 추천작`} movies={latestMovies} onMovieClick={handleMovieClick} />
              <div className="h-px bg-gray-800 my-8"></div>
              <Top10Section title="👑 넷플픽 유저들이 꼽은 명작 베스트" movies={bestMovies} onMovieClick={handleMovieClick} />
              <div className="h-px bg-gray-800 my-8"></div>
              <Top10Section title="☠️ 넷플픽 유저가 뽑은 비추천 영화" movies={worstMovies} isWorst={true} onMovieClick={handleMovieClick} />
            </>
          } />

          {/* 2. 최신 리뷰 방 - 검색 노출 O */}
          <Route path="/latest-reviews" element={
            <>
              <Helmet><title>넷플릭스 최신 리뷰 모음 - 넷플픽</title></Helmet>
              <LatestReviewsSection latestReviews={globalLatestReviews} onMovieClick={handleMovieClick} />
            </>
          } />

          {/* 3. 매불쇼 시네마지옥 방 - 검색 노출 O */}
          <Route path="/cinema-hell" element={
            <>
              <Helmet><title>매불쇼 시네마지옥 넷플릭스 평점 - 넷플픽</title></Helmet>
              <CinemaHellSection isAdmin={isAdmin} onMovieClick={handleMovieClick} onRefreshGlobal={fetchAllMovieData} />
            </>
          } />

          {/* 4. 나의 평점 방 - 검색 노출 O (개인 데이터지만 레이아웃은 수집되도록) */}
          <Route path="/my-ratings" element={
            <>
              <Helmet><title>나의 영화 평점 - 넷플픽</title></Helmet>
              {!dbUser ? <LoginRequiredMessage onLoginClick={() => setIsLoginModalOpen(true)} /> : (
                <MyRatingsSection myRatingsData={myRatings} onMovieClick={handleMovieClick} onDeleteRating={handleDeleteRating} onEditRating={(item) => { setEditingReview(item); setIsReviewModalOpen(true); }} />
              )}
            </>
          } />

          {/* 5. 나의 취향 분석 방 (noindex: 로봇 수집 금지) */}
          <Route path="/my-taste" element={
            <>
              <Helmet>
                <title>나의 취향 - 넷플픽</title>
                <meta name="robots" content="noindex, nofollow" />
              </Helmet>
              {!dbUser ? <LoginRequiredMessage onLoginClick={() => setIsLoginModalOpen(true)} /> : <MyTasteSection myRatings={myRatings} allRatings={allRatings} allCinemaReviews={allCinemaReviews} onMovieClick={handleMovieClick} />}
            </>
          } />

          {/* 6. 운영자 회원 관리 방 (noindex: 로봇 수집 금지) */}
          <Route path="/admin-users" element={
            <>
              <Helmet>
                <title>운영자 전용 - 넷플픽</title>
                <meta name="robots" content="noindex, nofollow" />
              </Helmet>
              {isAdmin && <AdminUserSection />}
            </>
          } />

          {/* 7. 기존에 설정되어 있던 게시판과 상세페이지 방들 (유지) */}
          <Route path="/movie/:id" element={<MovieDetailPage myRatings={myRatings} onOpenReviewForm={handleOpenReviewForm} />} />
          <Route path="/board/:type" element={<BoardListPage user={dbUser} onLoginRequired={() => setIsLoginModalOpen(true)} />} />
          <Route path="/board/:type/:postId" element={<BoardDetailPage user={dbUser} onLoginRequired={() => setIsLoginModalOpen(true)} />} />
        </Routes>
      </main>

      <NicknameModal isOpen={showNicknameModal} onSubmit={handleNicknameSubmit} onCancel={handleNicknameCancel} />
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
      
      <ReviewModal 
        isOpen={isReviewModalOpen} 
        onClose={() => {setIsReviewModalOpen(false); setSelectedMovieForReview(null); setEditingReview(null);}} 
        onAddRating={handleAddRating} 
        onUpdateRating={(updated) => {
           setMyRatings(prev => prev.map(r => r.docId === updated.docId ? updated : r));
           fetchAllMovieData();
        }}
        user={dbUser} 
        initialMovie={selectedMovieForReview} 
        myRatings={myRatings} 
        editingReview={editingReview}
      />
    </div>
  );
}
