import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, useParams, Link } from 'react-router-dom';

// ==========================================
// 1. Firebase 및 초기화 세팅
// ==========================================
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, getDoc, setDoc, updateDoc, where } from 'firebase/firestore';
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

const CINEMA_HELL_PANELS = ['전체', '신작', '전찬일', '라이너', '거의없다', '최광희', '최욱', '기타'];

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

  useEffect(() => {
    if (!movie) { navigate('/'); return; }
    document.title = `${movie.title} 평점 및 한줄평 모음 - 넷플픽`;
    
    // TMDB에서 개봉일, 장르, 줄거리 + 감독/출연진 정보 가져오기
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

    // DB에서 실제 리뷰(유저 평가 + 시네마지옥 기록) 가져오기
    const fetchReviews = async () => {
      if (!db) return;
      try {
        const rSnap = await getDocs(query(collection(db, "ratings"), where("id", "==", movie.id)));
        const cSnap = await getDocs(query(collection(db, "cinema_reviews"), where("id", "==", movie.id)));
        
        const reviews = [];
        rSnap.forEach(doc => reviews.push({ ...doc.data(), isCinema: false }));
        cSnap.forEach(doc => {
          const data = doc.data();
          reviews.push({
            id: doc.id,
            nickname: data.reviewerName,
            rating: data.rating,
            isRecommend: data.isRecommend,
            comment: data.comment,
            date: data.broadcastDate,
            isCinema: true
          });
        });
        // 최신순 정렬
        reviews.sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
        setActualReviews(reviews);
      } catch(e) { console.error(e); }
    };
    fetchReviews();
  }, [movie, navigate]);

  if (!movie) return null;

  const displayReviews = reviewMode === 'collapsed' ? actualReviews.slice(0, 3) : actualReviews;

  return (
    <div className="max-w-2xl mx-auto animate-fadeIn mt-4">
      <div className="flex flex-col sm:flex-row gap-5 mb-8 bg-gray-800 p-4 md:p-6 rounded-2xl border border-gray-700 shadow-xl">
        <img src={movie.poster} alt={movie.title} className="w-32 md:w-40 h-auto object-cover rounded-xl shadow-lg shrink-0 mx-auto sm:mx-0" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(movie.title)}`; }} />
        <div className="flex flex-col justify-center flex-1 text-center sm:text-left">
          <h2 className="text-xl md:text-2xl font-extrabold text-white mb-2">{movie.title}</h2>
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
                     {review.isRecommend ? <span className="text-green-400 text-[10px] border border-green-500 px-1.5 py-0.5 rounded bg-green-900/20">추천</span> : <span className="text-red-400 text-[10px] border border-red-500 px-1.5 py-0.5 rounded bg-red-900/20">비추천</span>}
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

// ... 이하 컴포넌트(게시판, 모달 등)는 그대로 유지
// (BoardListPage, BoardDetailPage, BoardWriteModal, LoginRequiredMessage, NicknameModal, LoginModal, ReviewModal, LatestReviewsSection, MyTasteSection, MyRatingsSection, AdminCinemaInputRow, AdminCinemaModal, CinemaHellSection)
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
        uid: user.uid,
        nickname: user.nickname,
        type: type,
        title: title,
        content: content,
        date: new Date().toISOString(),
        isNotice: isAdmin && isNotice,
        imageUrl: imageUrl,
        likes: 0,
        dislikes: 0,
        votedUsers: []
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
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl p-6 text-white shadow-2xl flex flex-col h-[85vh]">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <h2 className="text-2xl font-bold">새 글 작성</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl font-bold hover:text-white">&times;</button>
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
  if (!isOpen) return null;
  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); onClose(); } 
    catch (error) { alert("로그인 중 오류가 발생했습니다."); }
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-6 text-center">
        <h2 className="text-xl font-bold text-white mb-2">NETFL<span className="text-red-600">PICK</span> 로그인</h2>
        <p className="text-gray-400 text-sm mb-6">기기를 변경해도 평점과 글이 영구 보관됩니다.</p>
        <button onClick={handleGoogleLogin} className="w-full bg-white text-gray-800 font-bold py-3 rounded-md shadow-lg">G Google로 시작하기</button>
        <button onClick={onClose} className="mt-4 text-xs text-gray-500 hover:text-white">닫기</button>
      </div>
    </div>
  );
};

const ReviewModal = ({ isOpen, onClose, onAddRating, user, initialMovie, myRatings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [rating, setRating] = useState(0); 
  const [isRecommend, setIsRecommend] = useState(null); 
  const [reviewText, setReviewText] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (initialMovie) {
        setSelectedMovie({ id: initialMovie.id, title: initialMovie.title, poster: initialMovie.poster });
        setSearchTerm(''); setSearchResults([]);
      } else {
        setSelectedMovie(null); setSearchTerm('');
      }
      setRating(0); setIsRecommend(null); setReviewText('');
    }
  }, [isOpen, initialMovie]);

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
    if (myRatings.some(r => r.id === selectedMovie.id)) {
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
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg p-6 text-white shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">평점 남기기</h2>
          <button onClick={onClose} className="text-gray-400 text-xl font-bold hover:text-white">&times;</button>
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
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex gap-4 items-center bg-gray-800 p-4 rounded relative border border-gray-700">
              {!initialMovie && <button onClick={() => setSelectedMovie(null)} className="absolute top-3 right-3 text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-white">다른 작품 검색</button>}
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
            <button onClick={handleSubmit} className="w-full bg-red-600 py-4 font-extrabold text-lg rounded shadow-lg hover:bg-red-700 transition-colors">DB에 등록하기</button>
          </div>
        )}
      </div>
    </div>
  );
};

const LatestReviewsSection = ({ latestReview, onMovieClick }) => (
  <section className="animate-fadeIn">
    <div className="mb-12 bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl">
      <h2 className="text-xl font-bold text-white mb-4">🔥 가장 최근 등록된 평가</h2>
      {latestReview ? (
        <div className="flex gap-6 items-center">
          <img src={latestReview.poster} onClick={() => onMovieClick(latestReview)} alt="" className="w-24 h-36 object-cover rounded bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(latestReview.title)}`; }} />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-2xl font-bold text-white cursor-pointer hover:text-red-400 transition-colors" onClick={() => onMovieClick(latestReview)}>{latestReview.title}</h3>
              {latestReview.isRecommend ? <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">👍 추천</span> : <span className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-full">👎 비추천</span>}
            </div>
            <p className="text-sm text-gray-400 mb-2">작성자: <span className="text-gray-200 font-bold">{latestReview.reviewerName || latestReview.nickname || '익명'}</span> {latestReview.isCinema && <span className="text-red-500 text-xs">(매불쇼)</span>}</p>
            <p className="text-yellow-400 font-bold mb-2">★ {Number(latestReview.rating).toFixed(1)} / 10</p>
            <p className="text-gray-300 italic bg-gray-900 p-3 rounded border border-gray-700">"{latestReview.comment}"</p>
          </div>
        </div>
      ) : <p className="text-gray-500 text-center py-10">등록된 리뷰가 없습니다.</p>}
    </div>
  </section>
);

const MyTasteSection = ({ myRatings, onMovieClick }) => {
  const [expandedUserId, setExpandedUserId] = useState(null);
  const myLikes = myRatings.filter(r => r.isRecommend);
  const myDislikes = myRatings.filter(r => !r.isRecommend);
  const matchingUsers = [
    { id: 1, name: '시네마천국', avatar: '😎', matchRate: 94, tags: ['#스릴러매니아'], commonLikes: myLikes.slice(0, 3), commonDislikes: myDislikes.slice(0, 1) },
    { id: 2, name: '방구석크리틱', avatar: '🤓', matchRate: 88, tags: ['#드라마'], commonLikes: myLikes.slice(0, 1), commonDislikes: [] },
  ];

  return (
    <section className="animate-fadeIn">
      <div className="text-center mb-10"><h2 className="text-3xl font-extrabold text-white mb-2">🤝 나와 <span className="text-red-500">취향이 맞는</span> 유저 Top 5</h2></div>
      <div className="flex flex-col gap-4">
        {matchingUsers.map((user, idx) => {
          const isExpanded = expandedUserId === user.id;
          return (
            <div key={user.id} className={`bg-gray-800 border transition-all rounded-xl p-6 relative shadow-lg ${isExpanded ? 'border-red-500' : 'border-gray-700'}`}>
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedUserId(isExpanded ? null : user.id)}>
                <div className="flex items-center gap-4">
                  <span className="bg-red-600 text-white font-bold px-3 py-1 rounded-lg text-sm">{idx + 1}위</span>
                  <span className="text-3xl">{user.avatar}</span>
                  <h3 className="text-lg font-bold text-white">{user.name}</h3>
                </div>
                <div className="text-red-400 font-extrabold text-xl">일치율 {user.matchRate}%</div>
              </div>
              {isExpanded && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3"><span className="text-green-400">👍</span> 같이 추천한 영화</h4>
                  <div className="flex flex-wrap gap-4">
                    {user.commonLikes.length === 0 && <span className="text-gray-500 text-sm">없음</span>}
                    {user.commonLikes.map((m, i) => (
                      <div key={i} className="flex flex-col items-center w-20">
                        <img src={m.poster} onClick={(e) => { e.stopPropagation(); onMovieClick(m); }} alt="" className="w-20 h-28 object-cover rounded shadow-md mb-1 bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(m.title)}`; }} />
                        <span className="text-xs text-gray-200 truncate w-full text-center">{m.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const MyRatingsSection = ({ myRatingsData, onMovieClick }) => {
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
          <div key={idx} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex gap-6 items-center relative">
            <img src={item.poster} onClick={() => onMovieClick(item)} alt={item.title} className="w-20 h-28 object-cover rounded shadow-md bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(item.title)}`; }} />
            <div className="flex-1 pr-10">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-white mb-1 cursor-pointer hover:text-red-400 transition-colors" onClick={() => onMovieClick(item)}>{item.title}</h3>
                {item.isRecommend ? <span className="text-green-400 text-xs border border-green-400 px-2 rounded">👍 추천</span> : <span className="text-red-400 text-xs border border-red-400 px-2 rounded">👎 비추천</span>}
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
               <select value={value.otherName} onChange={e => onChange({...value, otherName: e.target.value})} className="p-2 bg-gray-900 text-white border border-gray-700 rounded text-sm outline-none">
                  <option value="배순탁">배순탁</option>
                  <option value="주성철">주성철</option>
                  <option value="송경원">송경원</option>
                  <option value="달시파켓">달시파켓</option>
                  <option value="직접입력">직접 입력</option>
               </select>
               {value.otherName === '직접입력' && (
                 <input type="text" placeholder="이름 직접 입력" value={value.customName} onChange={e => onChange({...value, customName: e.target.value})} className="p-2 bg-gray-900 border border-gray-700 rounded text-sm text-white flex-1 outline-none focus:border-red-500" />
               )}
            </div>
         )}
         <div className="flex gap-3 items-center mb-3 bg-gray-900 p-2 rounded">
           <img src={value.poster} alt="" className="w-12 h-16 object-cover rounded shadow-md" />
           <span className="font-bold text-sm text-white">{value.title}</span>
         </div>
         {isNewRelease && (
           <div className="flex gap-2 mb-2">
             <button onClick={() => onChange({...value, isRecommend: true})} className={`flex-1 py-1.5 rounded text-sm font-bold ${value.isRecommend ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>👍 추천</button>
             <button onClick={() => onChange({...value, isRecommend: false})} className={`flex-1 py-1.5 rounded text-sm font-bold ${!value.isRecommend ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}>👎 비추천</button>
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
           <div className="p-3 bg-red-900/30 hover:bg-red-900/50 cursor-pointer text-center text-red-400 text-xs font-bold" onClick={() => {
               onChange({...value, movieId: Date.now(), title: searchTerm, poster: `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(searchTerm)}`});
               setSearchTerm(''); setResults([]);
           }}>"{searchTerm}" 직접 입력하기</div>
         </div>
       )}
    </div>
  );
};

const AdminCinemaModal = ({ isOpen, onClose, onAddCinemaReview }) => {
  const [date, setDate] = useState(getRecentFridayKST());
  const [newRelease, setNewRelease] = useState({ title: '', isRecommend: true, comment: '' });
  const [jeon, setJeon] = useState({ title: '', comment: '' });
  const [liner, setLiner] = useState({ title: '', comment: '' });
  const [none, setNone] = useState({ title: '', comment: '' });
  const [choiG, setChoiG] = useState({ title: '', comment: '' });
  const [choiW, setChoiW] = useState({ title: '', comment: '' });
  const [other, setOther] = useState({ title: '', comment: '', otherName: '배순탁', customName: '' });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const entries = [
      { panel: '신작', data: newRelease }, { panel: '전찬일', data: jeon }, { panel: '라이너', data: liner },
      { panel: '거의없다', data: none }, { panel: '최광희', data: choiG }, { panel: '최욱', data: choiW }, { panel: '기타', data: other },
    ];

    const newReviews = [];
    for (const entry of entries) {
      if (entry.data.title.trim()) {
        const finalPanelName = entry.panel === '기타' ? ((entry.data.otherName === '직접입력' ? entry.data.customName : entry.data.otherName) || '기타') : entry.panel;
        const reviewObj = {
          id: entry.data.movieId || Date.now() + Math.random(),
          title: entry.data.title, poster: entry.data.poster,
          rating: entry.panel === '신작' ? (entry.data.isRecommend ? 8.0 : 4.0) : 8.0, 
          isRecommend: entry.panel === '신작' ? entry.data.isRecommend : true,
          comment: entry.data.comment || '한줄평 없음',
          panelName: entry.panel, reviewerName: finalPanelName, broadcastDate: date
        };
        newReviews.push(reviewObj);
      }
    }
    if(newReviews.length === 0) return alert("등록할 작품 제목을 최소 하나 이상 검색/입력해주세요.");
    
    try {
      if (db) {
        for (const review of newReviews) {
          await addDoc(collection(db, "cinema_reviews"), review);
        }
      }
      onAddCinemaReview(newReviews);
      setNewRelease({ title: '', isRecommend: true, comment: '' }); setJeon({ title: '', comment: '' }); setLiner({ title: '', comment: '' });
      setNone({ title: '', comment: '' }); setChoiG({ title: '', comment: '' }); setChoiW({ title: '', comment: '' }); setOther({ title: '', comment: '', otherName: '배순탁', customName: '' });
      onClose();
    } catch(e) {
      alert("DB 저장에 실패했습니다.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[80] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-xl p-6 text-white max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h2 className="text-xl font-bold text-red-500">🎬 시네마지옥 일괄 등록</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl font-bold hover:text-white">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
          <label className="block text-sm text-gray-400 mb-1">방송 날짜 (KST 기준 자동 세팅)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 bg-gray-800 rounded-lg mb-6 border border-gray-700 outline-none text-white focus:border-red-500" />
          <AdminCinemaInputRow label="[신작]" value={newRelease} onChange={setNewRelease} isNewRelease={true} />
          <AdminCinemaInputRow label="[전찬일]" value={jeon} onChange={setJeon} />
          <AdminCinemaInputRow label="[라이너]" value={liner} onChange={setLiner} />
          <AdminCinemaInputRow label="[거의없다]" value={none} onChange={setNone} />
          <AdminCinemaInputRow label="[최광희]" value={choiG} onChange={setChoiG} />
          <AdminCinemaInputRow label="[최욱]" value={choiW} onChange={setChoiW} />
          <AdminCinemaInputRow label="[기타 게스트]" value={other} onChange={setOther} isOther={true} />
        </div>
        <button onClick={handleSubmit} className="w-full mt-6 bg-red-600 hover:bg-red-700 py-4 font-bold rounded-xl text-lg shadow-lg shrink-0 transition-colors">기록 일괄 등록하기</button>
      </div>
    </div>
  );
};

const CinemaHellSection = ({ isAdmin, onMovieClick }) => {
  const [activePanel, setActivePanel] = useState('전체');
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [cinemaReviews, setCinemaReviews] = useState([]);

  useEffect(() => {
    const fetchCinemaReviews = async () => {
      if (!db) return;
      try {
        const q = query(collection(db, "cinema_reviews"), orderBy("broadcastDate", "desc"));
        const snap = await getDocs(q);
        const fetched = [];
        snap.forEach(doc => fetched.push({ dbId: doc.id, ...doc.data() }));
        setCinemaReviews(fetched);
      } catch (e) {
        console.error("시네마지옥 기록 로딩 실패:", e);
      }
    };
    fetchCinemaReviews();
  }, []);

  const handleAddCinemaReview = (newReviewsArray) => {
    setCinemaReviews(prev => [...newReviewsArray, ...prev]);
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

  const filteredReviews = activePanel === '전체' ? [] : cinemaReviews.filter(r => r.panelName === activePanel).sort((a,b) => b.rating - a.rating);

  return (
    <section className="animate-fadeIn">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white">🎬 매불쇼 <span className="text-red-500">시네마지옥</span></h2>
        {isAdmin && (
          <button onClick={() => setIsAdminModalOpen(true)} className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-4 py-2 rounded-md shadow-lg transition-colors">✏️ 방송 기록 등록</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {CINEMA_HELL_PANELS.map(panel => (
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
                <h3 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">{date} 방송</h3>
                <div className="flex overflow-x-auto gap-4 pb-4 snap-x">
                  {groupedByDate[date].map((review, index) => (
                    <div key={`${review.id}-${index}`} onClick={() => onMovieClick(review)} className="bg-gray-900 p-4 rounded-lg flex flex-col gap-3 border border-gray-700 relative shrink-0 w-64 snap-start hover:border-gray-500 cursor-pointer transition-colors group">
                      <div className="absolute -top-3 -left-3 bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md z-10">{review.reviewerName}</div>
                      <div className="flex gap-4">
                        <img src={review.poster} alt="" className="w-16 h-24 object-cover rounded shadow-md group-hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(review.title)}`; }} />
                        <div className="flex flex-col justify-center">
                          <h4 className="text-md font-bold text-white leading-tight mb-1">{review.title}</h4>
                          <div className="text-yellow-400 text-sm font-bold mb-1">★ {Number(review.rating).toFixed(1)}</div>
                          {review.isRecommend ? <span className="text-green-400 text-[10px] border border-green-500 px-2 py-0.5 rounded w-max">👍 추천</span> : <span className="text-red-400 text-[10px] border border-red-500 px-2 py-0.5 rounded w-max">👎 비추천</span>}
                        </div>
                      </div>
                      <p className="text-gray-300 text-sm text-center bg-gray-800 p-2 rounded truncate">"{review.comment}"</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReviews.map((review, index) => (
              <div key={`${review.id}-${index}`} onClick={() => onMovieClick(review)} className="bg-gray-900 p-4 rounded-lg flex gap-4 border border-gray-700 hover:border-gray-500 cursor-pointer transition-colors group">
                <img src={review.poster} alt="" className="w-16 h-24 object-cover rounded shadow-md shrink-0 group-hover:opacity-80 transition-opacity" onError={(e) => { e.target.src = `https://placehold.co/300x450/333333/FFFFFF?text=${encodeURIComponent(review.title)}`; }} />
                <div className="flex flex-col justify-center w-full">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="text-md font-bold text-white leading-tight truncate pr-2">{review.title}</h4>
                    {review.isRecommend ? <span className="text-green-400 text-[10px] border border-green-500 px-1 rounded shrink-0">추천</span> : <span className="text-red-400 text-[10px] border border-red-500 px-1 rounded shrink-0">비추천</span>}
                  </div>
                  <div className="text-yellow-400 text-sm font-bold mb-1">★ {Number(review.rating).toFixed(1)}</div>
                  <span className="text-gray-500 text-[10px] mb-1">{review.broadcastDate} | {review.reviewerName}</span>
                  <p className="text-gray-300 text-xs truncate">"{review.comment}"</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AdminCinemaModal isOpen={isAdminModalOpen} onClose={() => setIsAdminModalOpen(false)} onAddCinemaReview={handleAddCinemaReview} />
    </section>
  );
};


// ==========================================
// 4. 메인 앱 (라우팅 및 전체 상태 관리)
// ==========================================
export default function App() {
  return (
    <Router>
      <MainApp />
    </Router>
  );
}

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const [currentMenu, setCurrentMenu] = useState('home');
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [selectedMovieForReview, setSelectedMovieForReview] = useState(null);
  
  const [dbUser, setDbUser] = useState(null); 
  const [myRatings, setMyRatings] = useState([]); 
  
  const [latestMovies, setLatestMovies] = useState([]);
  const [bestMovies, setBestMovies] = useState([]);
  const [worstMovies, setWorstMovies] = useState([]);
  const [globalLatestReview, setGlobalLatestReview] = useState(null);

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

  // DB에 저장된 모든 평점과 시네마지옥 기록을 불러와서 Top10 랭킹을 만드는 함수
  const fetchAllMovieData = async () => {
    if (!db) return;
    try {
      const ratingsSnap = await getDocs(query(collection(db, "ratings"), orderBy("date", "desc")));
      const cinemaSnap = await getDocs(query(collection(db, "cinema_reviews"), orderBy("broadcastDate", "desc")));

      const movieMap = new Map();
      let latestGlobal = null;

      ratingsSnap.forEach(doc => {
        const data = doc.data();
        if (!movieMap.has(data.id)) {
          movieMap.set(data.id, { id: data.id, title: data.title, poster: data.poster, totalRating: 0, count: 0, recommends: 0, notRecommends: 0, latestDate: data.date });
        }
        const m = movieMap.get(data.id);
        m.totalRating += data.rating;
        m.count += 1;
        if (data.isRecommend) m.recommends += 1;
        else m.notRecommends += 1;
        if (new Date(data.date) > new Date(m.latestDate)) m.latestDate = data.date;

        if (!latestGlobal || new Date(data.date) > new Date(latestGlobal.date)) {
          latestGlobal = { ...data, isCinema: false };
        }
      });

      cinemaSnap.forEach(doc => {
        const data = doc.data();
        if (!movieMap.has(data.id)) {
          movieMap.set(data.id, { id: data.id, title: data.title, poster: data.poster, totalRating: 0, count: 0, recommends: 0, notRecommends: 0, latestDate: data.broadcastDate });
        }
        const m = movieMap.get(data.id);
        m.totalRating += data.rating;
        m.count += 1;
        if (data.isRecommend) m.recommends += 1;
        else m.notRecommends += 1;
        if (new Date(data.broadcastDate) > new Date(m.latestDate)) m.latestDate = data.broadcastDate;

        if (!latestGlobal || new Date(data.broadcastDate) > new Date(latestGlobal.date || latestGlobal.broadcastDate)) {
          latestGlobal = { ...data, date: data.broadcastDate, isCinema: true };
        }
      });

      const allMovies = Array.from(movieMap.values()).map(m => ({
        ...m,
        rating: (m.totalRating / m.count).toFixed(1)
      }));

      setLatestMovies([...allMovies].sort((a,b) => new Date(b.latestDate) - new Date(a.latestDate)));
      setBestMovies([...allMovies].filter(m => m.recommends > 0).sort((a,b) => b.rating - a.rating));
      setWorstMovies([...allMovies].filter(m => m.notRecommends > 0).sort((a,b) => a.rating - b.rating));
      setGlobalLatestReview(latestGlobal);

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

       const newUser = { uid: auth.currentUser.uid, nickname: trimmed, email: auth.currentUser.email };
       await setDoc(doc(db, "users", auth.currentUser.uid), newUser);
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
        if(doc.data().uid === uid) fetchedRatings.push(doc.data());
      });
      setMyRatings(fetchedRatings);
    } catch (error) { console.error("DB 에러:", error); }
  };

  const handleAddRating = (newRating) => {
    setMyRatings(prev => [newRating, ...prev]);
    fetchAllMovieData(); 
  };

  const handleMovieClick = (movie) => {
    navigate(`/movie/${movie.id}`, { state: { movie } });
  };

  const handleMenuClick = (menu) => {
    if (location.pathname !== '/') navigate('/');
    setCurrentMenu(menu);
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
          <h1 className="text-3xl font-extrabold text-red-600 cursor-pointer shrink-0" onClick={() => handleMenuClick('home')}>NETFL<span className="text-white">PICK</span></h1>
          
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
            <button onClick={() => handleMenuClick('home')} className={`transition-colors ${currentMenu === 'home' && location.pathname === '/' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>추천 영화</button>
            <button onClick={() => handleMenuClick('latest')} className={`transition-colors ${currentMenu === 'latest' && location.pathname === '/' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>최신 리뷰</button>
            <button onClick={() => handleMenuClick('taste')} className={`transition-colors ${currentMenu === 'taste' && location.pathname === '/' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>나의 취향</button>
            <button onClick={() => handleMenuClick('cinema')} className={`transition-colors ${currentMenu === 'cinema' && location.pathname === '/' ? 'text-red-400 font-bold border-b-2 border-red-400 pb-1' : 'text-gray-400 hover:text-red-300'}`}>매불쇼 시네마지옥</button>
            <button onClick={() => navigate('/board/general')} className={`transition-colors ${location.pathname === '/board/general' ? 'text-yellow-400 font-bold border-b-2 border-yellow-400 pb-1' : 'text-gray-400 hover:text-yellow-300'}`}>전체 게시판</button>
            <button onClick={() => navigate('/board/qna')} className={`transition-colors ${location.pathname === '/board/qna' ? 'text-blue-400 font-bold border-b-2 border-blue-400 pb-1' : 'text-gray-400 hover:text-blue-300'}`}>질문/답변</button>
            <button onClick={() => handleMenuClick('myRatings')} className={`transition-colors ${currentMenu === 'myRatings' && location.pathname === '/' ? 'text-white font-bold border-b-2 border-white pb-1' : 'text-gray-400 hover:text-gray-200'}`}>나의 평점</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        <Routes>
          <Route path="/" element={
            <>
              {currentMenu === 'home' && (
                <>
                  <Top10Section title="🔥 유저들이 선택한 최신 추천작" movies={latestMovies} onMovieClick={handleMovieClick} />
                  <div className="h-px bg-gray-800 my-8"></div>
                  <Top10Section title="👑 넷플픽 명작 베스트" movies={bestMovies} onMovieClick={handleMovieClick} />
                  <div className="h-px bg-gray-800 my-8"></div>
                  <Top10Section title="☠️ 넷플픽 최악 워스트" movies={worstMovies} isWorst={true} onMovieClick={handleMovieClick} />
                </>
              )}
              {currentMenu === 'latest' && <LatestReviewsSection latestReview={globalLatestReview} onMovieClick={handleMovieClick} />}
              {currentMenu === 'taste' && (!dbUser ? <LoginRequiredMessage onLoginClick={() => setIsLoginModalOpen(true)} /> : <MyTasteSection myRatings={myRatings} onMovieClick={handleMovieClick} />)}
              {currentMenu === 'myRatings' && (!dbUser ? <LoginRequiredMessage onLoginClick={() => setIsLoginModalOpen(true)} /> : <MyRatingsSection myRatingsData={myRatings} onMovieClick={handleMovieClick} />)}
              {currentMenu === 'cinema' && <CinemaHellSection isAdmin={isAdmin} onMovieClick={handleMovieClick} />}
            </>
          } />
          
          <Route path="/movie/:id" element={<MovieDetailPage myRatings={myRatings} onOpenReviewForm={handleOpenReviewForm} />} />
          <Route path="/board/:type" element={<BoardListPage user={dbUser} onLoginRequired={() => setIsLoginModalOpen(true)} />} />
          <Route path="/board/:type/:postId" element={<BoardDetailPage user={dbUser} onLoginRequired={() => setIsLoginModalOpen(true)} />} />
        </Routes>
      </main>

      <NicknameModal isOpen={showNicknameModal} onSubmit={handleNicknameSubmit} onCancel={handleNicknameCancel} />
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
      <ReviewModal isOpen={isReviewModalOpen} onClose={() => {setIsReviewModalOpen(false); setSelectedMovieForReview(null);}} onAddRating={handleAddRating} user={dbUser} initialMovie={selectedMovieForReview} myRatings={myRatings} />
    </div>
  );
}